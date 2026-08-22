import SpriteText from "https://esm.sh/three-spritetext";

// Performance Optimization: Monkey-patch THREE.CylinderGeometry to be open-ended (openEnded = true).
// This removes cylinder caps (reducing faces from 24 to 12 per link), as they are always hidden inside node spheres anyway.
const OriginalCylinderGeometry = THREE.CylinderGeometry;
THREE.CylinderGeometry = function(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength) {
  return new OriginalCylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    radialSegments,
    heightSegments,
    true, // force openEnded to be true (no caps)
    thetaStart,
    thetaLength
  );
};
Object.setPrototypeOf(THREE.CylinderGeometry, OriginalCylinderGeometry);
THREE.CylinderGeometry.prototype = OriginalCylinderGeometry.prototype;

// (Modified) Tableau 10 Color Cycle Palette
const TAB10_COLORS = [
  '#0080D0', // Blue
  '#D96B00', // Orange
  '#00C900', // Green
  '#D00000', // Red
  '#7040B0', // Purple
  '#C04020', // Vermilion
  '#D04090', // Pink
  '#70C000', // Lime / Chartreuse
  '#D0C000', // Yellow
  '#00C8C8', // Cyan
  '#0098D0', // Sky Blue
  '#D000D0', // Magenta
  '#A000D0', // Violet
  '#00C890', // Spring Green
  '#00C0A0', // Turquoise
];

// Institute Colors Mapping (Populated dynamically on data load)
const INSTITUTE_COLORS = {};

// Performance Caching Caches
const SHARED_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 16, 16);
const TEXTURE_CACHE = {};

// Global App State
let allGraphData = { nodes: [], links: [] };
let activeGraphData = { nodes: [], links: [] };
let authorInstitutes = {};
let publicationsList = [];
let hoveredNode = null;
let selectedNode = null;
const highlightNodes = new Set();
const highlightLinks = new Set();

// Active filters
const activeInstitutes = new Set();
let dynamicInstitutesList = [];
let isInitializing = true;


// DOM Elements
const loader = document.getElementById('loader');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchSuggestions = document.getElementById('search-suggestions');
const detailPanel = document.getElementById('detail-panel');
const closeDetailBtn = document.getElementById('close-detail-btn');

// Detail Panel Elements
const authorName = document.getElementById('author-name');
const authorInstitutesContainer = document.getElementById('author-institutes');
const authorPubCount = document.getElementById('author-pub-count');
const authorCoauthorCount = document.getElementById('author-coauthor-count');
const authorPublications = document.getElementById('author-publications');
const authorConnections = document.getElementById('author-connections');

// Stats Elements
const statNodesCount = document.getElementById('stat-nodes-count');
const statLinksCount = document.getElementById('stat-links-count');

// Initialize 3D Force Graph
const Graph = ForceGraph3D()(document.getElementById('3d-graph'))
  .backgroundColor('#06060c')
  .showNavInfo(false)
  .nodeLabel(node => `<div class="scene-tooltip"><strong>${node.name}</strong><br/>${node.institutes.join(', ')} (${node.val} pubs)</div>`)
  .linkLabel(link => `<div class="scene-tooltip">Connection strength: <strong>${link.value}</strong></div>`)
  .linkResolution(3) // Low-poly triangular volumetric cylinders (incredibly fast rendering but keeps beautiful 3D volume!)
  .linkWidth(link => Math.min(10, Math.sqrt(Math.max(1, link.value * 0.6)))) // Static width based on connection strength - avoids rebuilding geometries on hover!
  .linkColor(link => {
    const isHighlighted = highlightNodes.size === 0 || highlightLinks.has(link);
    if (isHighlighted) {
      // Scale opacity by connection strength for stunning detailed aesthetics
      const opacity = Math.min(1, 0.5 + (link.value / 4));
      return `rgba(255, 255, 255, 1)`;
    } else {
      return 'rgba(255, 255, 255, 0)'; // dim out unrelated links completely
    }
  })
  .onNodeHover(handleNodeHover)
  .onNodeClick(handleNodeClick)
  .nodeThreeObject(node => {
    const institutes = node.institutes || ['DEFAULT'];
    const group = new THREE.Group();
    const nodeSize = Math.cbrt(node.val) * 3;
    
    // --- 1. GET OR CREATE SHARED CANVAS TEXTURE FROM CACHE ---
    const cacheKey = [...institutes].sort().join('|');
    let sphereTexture = TEXTURE_CACHE[cacheKey];
    if (!sphereTexture) {
      const sphereCanvas = document.createElement('canvas');
      sphereCanvas.width = 128;
      sphereCanvas.height = 128;
      const sCtx = sphereCanvas.getContext('2d');
      
      if (institutes.length <= 1) {
        sCtx.fillStyle = INSTITUTE_COLORS[institutes[0]] || INSTITUTE_COLORS.DEFAULT;
        sCtx.fillRect(0, 0, 128, 128);
      } else {
        const colWidth = 128 / institutes.length;
        institutes.forEach((inst, i) => {
          sCtx.fillStyle = INSTITUTE_COLORS[inst] || INSTITUTE_COLORS.DEFAULT;
          sCtx.fillRect(i * colWidth, 0, colWidth, 128);
        });
      }
      
      sphereTexture = new THREE.CanvasTexture(sphereCanvas);
      TEXTURE_CACHE[cacheKey] = sphereTexture;
    }
    
    // --- 2. CREATE LIGHTWEIGHT UNIQUE MATERIAL SHARING THE CACHED TEXTURE ---
    // (A unique material per node is required so that highlighting/opacity updates can be independent)
    const sphereMat = new THREE.MeshBasicMaterial({
      map: sphereTexture,
      transparent: true,
      opacity: 1.0
    });
    
    // --- 3. INSTANTIATE SPHERE USING SHARED GEOMETRY (SCALED) ---
    const sphereMesh = new THREE.Mesh(SHARED_SPHERE_GEOMETRY, sphereMat);
    sphereMesh.scale.setScalar(nodeSize);
    group.add(sphereMesh);
    
    // --- 4. BUILD THE FLOATING LABEL ---
    const sprite = new SpriteText(node.name);
    sprite.material.depthWrite = false; // make sprite background transparent
    const primaryInst = institutes[0] || 'DEFAULT';
    sprite.color = INSTITUTE_COLORS[primaryInst] || INSTITUTE_COLORS.DEFAULT;
    sprite.textHeight = 10;
    sprite.padding = 1;    // Add padding to prevent diacritics (e.g. Ž) from clipping
    sprite.center.y = -1.4 - nodeSize * 0.1; // shift above node
    
    // Disable raycasting on the sprite so hover events/tooltips only target the sphere!
    sprite.raycast = () => null;
    
    group.add(sprite);
    
    // Save references for dynamic highlights/updates
    node.__mesh = group; 
    node.__sphereMesh = sphereMesh;
    node.__sprite = sprite;
    
    // Dynamic default visibility: show label only if highlighted or if prominent (val >= 15)
    const activeNode = hoveredNode || selectedNode;
    if (activeNode) {
      sprite.visible = highlightNodes.has(node);
    } else {
      sprite.visible = node.val >= 15;
    }
    
    return group;
  });

// Configure default hardcoded forces (Requirement 2)
Graph.d3Force('charge').strength(-800);
Graph.d3Force('link').distance(200);

// Add custom gravity pulling all nodes towards (0,0,0) (Requirement 1 & 2)
Graph.d3Force('gravity', (() => {
  return (alpha) => {
    const strength = 0.08; // pull strength
    activeGraphData.nodes.forEach(node => {
      if (typeof node.x === 'number' && !isNaN(node.x)) {
        node.vx -= node.x * strength * alpha;
      }
      if (typeof node.y === 'number' && !isNaN(node.y)) {
        node.vy -= node.y * strength * alpha;
      }
      if (typeof node.z === 'number' && !isNaN(node.z)) {
        node.vz -= node.z * strength * alpha;
      }
    });
  };
})());

// Fetch Data & Kickoff
fetch('network_data.json?v=' + Date.now())
  .then(res => {
    if (!res.ok) throw new Error(`Failed to fetch network_data.json: ${res.status} ${res.statusText}`);
    return res.json();
  })
  .then(networkData => {
    const pubFiles = networkData.publication_files || ['publications.txt'];
    console.log('=== DATA LOADING ===');
    console.log('Publication files from network_data.json:', pubFiles);
    
    return Promise.all([
      Promise.resolve(networkData),
      fetch('author_institutes.json?v=' + Date.now()).then(res => {
        if (!res.ok) throw new Error(`Failed to fetch author_institutes.json: ${res.status} ${res.statusText}`);
        return res.json();
      }),
      Promise.all(pubFiles.map(file => fetch(file + '?v=' + Date.now()).then(res => {
        if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status} ${res.statusText}`);
        return res.text();
      })))
    ]);
  })
  .then(([networkData, institutes, pubsTexts]) => {
    const pubsText = pubsTexts.join('\n');
    console.log(`Successfully fetched and merged ${pubsTexts.length} publication file(s). Total merged length: ${pubsText.length} characters.`);
    allGraphData = networkData;
    authorInstitutes = institutes;
  
  // Extract all unique institutes dynamically! (Requirement 7)
  const institutesSet = new Set();
  allGraphData.nodes.forEach(node => {
    if (node.institutes) {
      node.institutes.forEach(inst => institutesSet.add(inst));
    }
  });
  dynamicInstitutesList = Array.from(institutesSet).sort();
  
  // Map dynamic institutes to TAB10_COLORS! (Requirement 7)
  dynamicInstitutesList.forEach((inst, idx) => {
    INSTITUTE_COLORS[inst] = TAB10_COLORS[idx % TAB10_COLORS.length];
  });
  INSTITUTE_COLORS['DEFAULT'] = '#70a1ff';
  
  // Initialize activeInstitutes as empty by default (Requirement: off by default to avoid lag)
  activeInstitutes.clear();
  
  // Parse URL Parameters
  const urlParams = new URLSearchParams(window.location.search);
  const instituteArg = urlParams.get('institute');
  const authorArg = urlParams.get('author');
  const isolatedArg = urlParams.get('isolated');
  
  const showIsolatedChk = document.getElementById('show-isolated-chk');
  if (showIsolatedChk && (isolatedArg === '0' || isolatedArg === 'false')) {
    showIsolatedChk.checked = false;
  }
  
  if (instituteArg) {
    activeInstitutes.clear();
    dynamicInstitutesList.forEach((inst, idx) => {
      // If bitmask has character and it's '1', include it. If bitmask is shorter, default to '0' (off).
      const char = instituteArg[idx];
      if (char === '1') {
        activeInstitutes.add(inst);
      }
    });
  }
  
  // Pre-parse publications with a fast regex to avoid CPU-heavy DOMParser during runtime
  const authorRegex = /<author[^>]*>([^<]+)<\/author>/g;
  publicationsList = pubsText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(pubHtml => {
      const authors = [];
      let match;
      authorRegex.lastIndex = 0;
      while ((match = authorRegex.exec(pubHtml)) !== null) {
        authors.push(normalizeAuthorName(match[1]).toLowerCase());
      }
      return {
        html: pubHtml,
        authors: authors
      };
    });
  
  // Filter out nodes with 0 or invalid publications
  allGraphData.nodes = allGraphData.nodes.filter(node => (Number(node.val) || 0) > 0);
  
  // Clean up any links referencing removed nodes
  const validNodeIds = new Set(allGraphData.nodes.map(n => n.id));
  allGraphData.links = allGraphData.links.filter(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    return validNodeIds.has(sourceId) && validNodeIds.has(targetId);
  });
  
  // Save normalized values as numbers
  allGraphData.nodes.forEach(node => {
    node.val = Number(node.val) || 0;
  });
  
  // Build and render dynamic filter checkboxes! (Requirement 7)
  renderDynamicFilters(dynamicInstitutesList);
  
  // Update state and render
  updateGraph();
  setupEventListeners();
  
  // If author query parameter is present, select them on load!
  if (authorArg) {
    const targetNode = activeGraphData.nodes.find(n => 
      n.id.toLowerCase() === authorArg.toLowerCase() || 
      n.name.toLowerCase() === authorArg.toLowerCase()
    );
    
    if (targetNode) {
      // Instantly open the details panel and apply selection highlights (so the UI is responsive immediately)
      selectedNode = targetNode;
      openDetailPanel(targetNode);
      updateHighlights();
      
      // Wait for the simulation layout to completely settle before focusing camera
      let focused = false;
      let focusTimeout = null;
      const focusCamera = () => {
        if (focused) return;
        focused = true;
        if (focusTimeout) clearTimeout(focusTimeout);
        Graph.onEngineStop(() => {}); // Clean up the engine stop listener
        
        // If the user has already navigated to a different node, do not override their action
        if (selectedNode !== targetNode) return;
        handleNodeClick(targetNode);
      };
      Graph.onEngineStop(focusCamera);
      focusTimeout = setTimeout(focusCamera, 1000); // Fail-safe fallback if engine settles immediately
    }
  }
  
  // Done initializing, future state changes should update the URL
  isInitializing = false;
  
  // Hide Loading Screen
  setTimeout(() => {
    loader.classList.add('fade-out');
  }, 300);
}).catch(err => {
  console.error('Error loading application dataset:', err);
  loader.querySelector('.loader-text').innerText = 'Error loading dataset. Please check if build_network.py has run successfully.';
});

// Render dynamic institute filter items into the DOM
function renderDynamicFilters(dynamicInstitutes) {
  const filterGroupContainer = document.getElementById('filter-group');
  if (!filterGroupContainer) return;
  
  filterGroupContainer.innerHTML = '';
  dynamicInstitutes.forEach(inst => {
    const label = document.createElement('label');
    label.className = 'filter-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = activeInstitutes.has(inst);
    checkbox.setAttribute('data-inst', inst);
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        activeInstitutes.add(inst);
      } else {
        activeInstitutes.delete(inst);
      }
      updateGraph();
    });
    
    const spanCheck = document.createElement('span');
    spanCheck.className = 'checkbox-custom';
    
    const updateCheckboxStyle = () => {
      if (checkbox.checked) {
        spanCheck.style.backgroundColor = INSTITUTE_COLORS[inst];
        spanCheck.style.borderColor = 'transparent';
      } else {
        spanCheck.style.backgroundColor = 'transparent';
        spanCheck.style.borderColor = 'var(--text-muted)';
      }
    };
    checkbox.addEventListener('change', updateCheckboxStyle);
    updateCheckboxStyle(); // initial styling
    
    const spanLabel = document.createElement('span');
    spanLabel.className = 'filter-label';
    spanLabel.innerText = inst;
    
    label.appendChild(checkbox);
    label.appendChild(spanCheck);
    label.appendChild(spanLabel);
    filterGroupContainer.appendChild(label);
  });
}

// Update active graph elements based on filter selection
function updateGraph() {
  const filteredNodes = allGraphData.nodes.filter(node => 
    node.institutes.some(inst => activeInstitutes.has(inst))
  );
  
  const nodeIdsTemp = new Set(filteredNodes.map(n => n.id));
  
  const filteredLinks = allGraphData.links.filter(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    return nodeIdsTemp.has(sourceId) && nodeIdsTemp.has(targetId);
  });
  
  // Read dynamic "Show Isolated Authors" setting
  const showIsolatedChk = document.getElementById('show-isolated-chk');
  const showIsolated = showIsolatedChk ? showIsolatedChk.checked : true;
  
  let finalNodes = filteredNodes;
  if (!showIsolated) {
    const connectedNodeIds = new Set();
    filteredLinks.forEach(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      connectedNodeIds.add(sourceId);
      connectedNodeIds.add(targetId);
    });
    finalNodes = filteredNodes.filter(node => connectedNodeIds.has(node.id));
  }
  
  const nodeIds = new Set(finalNodes.map(n => n.id));
  
  activeGraphData = { nodes: finalNodes, links: filteredLinks };
  Graph.graphData(activeGraphData);

  // If selected node is no longer in visible nodes, close details and deselect, otherwise refresh panel to reflect new filters
  if (selectedNode) {
    if (!nodeIds.has(selectedNode.id)) {
      detailPanel.classList.add('hidden');
      selectedNode = null;
    } else {
      openDetailPanel(selectedNode);
    }
  }
  
  // Update overall UI stats
  statNodesCount.innerText = finalNodes.length;
  statLinksCount.innerText = filteredLinks.length;
  
  // Refresh highlights
  updateHighlights();
  
  // Sync state to URL query parameters
  updateURL();
}

// Generalized Highlights Updater (handles hover and selection state)
function updateHighlights() {
  highlightNodes.clear();
  highlightLinks.clear();
  
  // Decide which node is active (hovered has priority over selected)
  const activeNode = hoveredNode || selectedNode;
  
  if (activeNode) {
    highlightNodes.add(activeNode);
    
    // Find all directly connected links and neighbors
    activeGraphData.links.forEach(link => {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      
      if (source === activeNode.id) {
        highlightLinks.add(link);
        // O(1) performance lookup: use link.target directly if it's already a node object from force simulation
        const neighbor = typeof link.target === 'object' ? link.target : activeGraphData.nodes.find(n => n.id === target);
        if (neighbor) highlightNodes.add(neighbor);
      } else if (target === activeNode.id) {
        highlightLinks.add(link);
        // O(1) performance lookup: use link.source directly if it's already a node object from force simulation
        const neighbor = typeof link.source === 'object' ? link.source : activeGraphData.nodes.find(n => n.id === source);
        if (neighbor) highlightNodes.add(neighbor);
      }
    });
  }
  
  // High-speed direct property access instead of slow recursive traversal for 800+ nodes
  activeGraphData.nodes.forEach(n => {
    const isHighlighted = highlightNodes.size === 0 || highlightNodes.has(n);
    const targetOpacity = isHighlighted ? 1.0 : 0.15;
    
    if (n.__sphereMesh) {
      n.__sphereMesh.material.opacity = targetOpacity;
    }
    
    // Dynamic Label Visibility and Opacity Optimization:
    // When a node is hovered/selected, show labels ONLY for the highlighted node and its co-authors.
    // When nothing is selected, show labels only for prominent authors (val >= 15) to maintain superb rendering performance.
    if (n.__sprite) {
      n.__sprite.material.opacity = targetOpacity;
      if (activeNode) {
        n.__sprite.visible = highlightNodes.has(n);
      } else {
        n.__sprite.visible = n.val >= 15;
      }
    }
  });
  
  // Force link color/opacity updates (highly optimized, runs instantly without rebuilding geometries)
  Graph.linkColor(Graph.linkColor());
}

// Sync current filter & selected node state to URL query parameters
function updateURL() {
  if (isInitializing) return;
  const url = new URL(window.location.href);
  
  // Encode active institutes list as a bitmask (1 = checked, 0 = unchecked)
  if (dynamicInstitutesList && dynamicInstitutesList.length > 0) {
    let bitmask = '';
    dynamicInstitutesList.forEach(inst => {
      bitmask += activeInstitutes.has(inst) ? '1' : '0';
    });
    url.searchParams.set('institute', bitmask);
  }
  
  // Encode selected author name/ID
  if (selectedNode) {
    url.searchParams.set('author', selectedNode.id);
  } else {
    url.searchParams.delete('author');
  }
  
  // Encode isolated authors checkbox state (default is true, so only set parameter if hidden)
  const showIsolatedChk = document.getElementById('show-isolated-chk');
  if (showIsolatedChk) {
    if (!showIsolatedChk.checked) {
      url.searchParams.set('isolated', '0');
    } else {
      url.searchParams.delete('isolated');
    }
  }
  
  window.history.replaceState(null, '', url.toString());
}

// Hover Event Handler
function handleNodeHover(node) {
  if (hoveredNode === node) return;
  hoveredNode = node;
  updateHighlights();
}

// Click Event Handler
function handleNodeClick(node) {
  // Clear any pending on-load simulation zoom listeners to prevent overriding manual user clicks
  Graph.onEngineStop(() => {});
  
  selectedNode = node;
  
  // Find co-authors currently visible in the active graph
  const neighbors = activeGraphData.nodes.filter(n => {
    if (n.id === node.id) return false;
    return activeGraphData.links.some(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      return (sourceId === node.id && targetId === n.id) || (targetId === node.id && sourceId === n.id);
    });
  });
  
  // Calculate maximum distance to any co-author
  let maxDist = 0;
  neighbors.forEach(n => {
    const d = Math.hypot(n.x - node.x, n.y - node.y, n.z - node.z);
    if (d > maxDist) {
      maxDist = d;
    }
  });
  
  // Calculate dynamic camera distance (ensure minimum zoom level is comfortable, e.g., 180)
  const distance = Math.max(180, maxDist * 2.0 + 40);
  const nodeDist = Math.hypot(node.x, node.y, node.z) || 1;
  const distRatio = 1 + distance / nodeDist;
  
  Graph.cameraPosition(
    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, // camera coordinate
    node, // focal target (node position)
    1000  // transitions duration (ms)
  );
  
  // Open details panel
  openDetailPanel(node);
  
  // Apply selection highlights
  updateHighlights();
  
  // Sync state to URL query parameters
  updateURL();
}

// Normalizes "Lastname, Firstname" -> "Firstname Lastname"
function normalizeAuthorName(name) {
  name = name.trim();
  if (name.includes(',')) {
    const parts = name.split(',');
    return `${parts[1].trim()} ${parts[0].trim()}`;
  }
  return name;
}

// Parse raw HTML publication entries to find matches
function findPublicationsForAuthor(authorName) {
  const lowerName = authorName.toLowerCase();
  return publicationsList
    .filter(pub => pub.authors.includes(lowerName))
    .map(pub => pub.html);
}

// Detail Panel Populator
function openDetailPanel(node) {
  authorName.innerText = node.name;
  
  // Render colored tag groups dynamically
  authorInstitutesContainer.innerHTML = '';
  node.institutes.forEach(inst => {
    const span = document.createElement('span');
    span.className = `tag`;
    span.innerText = inst;
    const color = INSTITUTE_COLORS[inst] || INSTITUTE_COLORS.DEFAULT;
    span.style.backgroundColor = `${color}26`; // 15% opacity hex (26)
    span.style.color = color;
    span.style.borderColor = `${color}4d`; // 30% opacity hex (4d)
    authorInstitutesContainer.appendChild(span);
  });

  // Render positions dynamically
  const authorPositionsContainer = document.getElementById('author-positions');
  if (authorPositionsContainer) {
    authorPositionsContainer.innerHTML = '';
    if (node.pareigos && node.pareigos.length > 0) {
      node.pareigos.forEach(pos => {
        const div = document.createElement('div');
        div.className = 'position-item';
        div.style.borderLeft = `2px solid ${INSTITUTE_COLORS[node.institutes[0]] || 'rgba(255, 255, 255, 0.2)'}`;
        div.style.paddingLeft = '8px';
        div.style.marginBottom = '6px';
        div.style.fontSize = '0.9em';
        div.style.lineHeight = '1.3';
        div.style.color = 'var(--text-muted)';
        div.innerText = pos;
        authorPositionsContainer.appendChild(div);
      });
    }
  }
  
  authorPubCount.innerText = node.val;
  
  // Find co-authors count (only those currently visible in the simulation)
  const activeNodeIds = new Set(activeGraphData.nodes.map(n => n.id));
  const uniqueCoauthors = new Set();
  allGraphData.links.forEach(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    if (sourceId === node.id && activeNodeIds.has(targetId)) uniqueCoauthors.add(targetId);
    if (targetId === node.id && activeNodeIds.has(sourceId)) uniqueCoauthors.add(sourceId);
  });
  authorCoauthorCount.innerText = uniqueCoauthors.size;
  
  // Fetch and display publications
  authorPublications.innerHTML = '<div style="text-align:center; padding:20px; color:#747d8c;">Scanning publication logs...</div>';
  
  setTimeout(() => {
    const matchedPubs = findPublicationsForAuthor(node.id);
    authorPublications.innerHTML = '';
    
    if (matchedPubs.length === 0) {
      authorPublications.innerHTML = '<div style="text-align:center; padding:20px; color:#747d8c;">No indexed publications found.</div>';
    } else {
      matchedPubs.forEach(pubHtml => {
        const div = document.createElement('div');
        div.className = 'publication-item';
        div.innerHTML = pubHtml;
        authorPublications.appendChild(div);
      });
    }
  }, 50);

  // Fetch and display connections/co-authors immediately (since it's fast in-memory)
  authorConnections.innerHTML = '';
  const connections = [];
  allGraphData.links.forEach(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    const sourceNode = typeof link.source === 'object' ? link.source : null;
    const targetNode = typeof link.target === 'object' ? link.target : null;
    
    if (sourceId === node.id) {
      if (activeNodeIds.has(targetId)) {
        connections.push({
          id: targetId,
          node: targetNode || allGraphData.nodes.find(n => n.id === targetId),
          value: link.value
        });
      }
    } else if (targetId === node.id) {
      if (activeNodeIds.has(sourceId)) {
        connections.push({
          id: sourceId,
          node: sourceNode || allGraphData.nodes.find(n => n.id === sourceId),
          value: link.value
        });
      }
    }
  });

  // Sort connections descending by strength (value)
  connections.sort((a, b) => b.value - a.value);

  if (connections.length === 0) {
    authorConnections.innerHTML = '<div style="text-align:center; padding:20px; color:#747d8c;">No co-authors found.</div>';
  } else {
    connections.forEach(conn => {
      // Find primary institute color for the co-author
      const primaryInst = (conn.node && conn.node.institutes && conn.node.institutes[0]) || 'DEFAULT';
      const color = INSTITUTE_COLORS[primaryInst] || INSTITUTE_COLORS.DEFAULT;
      const name = conn.node ? conn.node.name : conn.id;
      const strengthStr = Number.isInteger(conn.value) ? conn.value.toString() : conn.value.toFixed(2);
      
      const itemDiv = document.createElement('div');
      itemDiv.className = 'connection-item';
      itemDiv.title = `Click to view ${name}'s network`;
      
      itemDiv.innerHTML = `
        <div class="connection-info">
          <span class="connection-dot" style="color: ${color};"></span>
          <span class="connection-name">${name}</span>
        </div>
        <span class="connection-strength">${strengthStr}</span>
      `;
      
      // Clicking a connection selects and focuses on that collaborator!
      itemDiv.addEventListener('click', () => {
        if (conn.node) {
          handleNodeClick(conn.node);
        }
      });
      
      authorConnections.appendChild(itemDiv);
    });
  }

  detailPanel.classList.remove('hidden');
}

// Setup Event Listeners (Filters, Search)
function setupEventListeners() {
  // Close details panel
  closeDetailBtn.addEventListener('click', () => {
    detailPanel.classList.add('hidden');
    selectedNode = null;
    updateHighlights();
    updateURL();
  });
  
  // Close details panel on background click (single click deselects, double click centers)
  let lastBgClickTime = 0;
  Graph.onBackgroundClick(() => {
    const now = Date.now();
    const delay = now - lastBgClickTime;
    lastBgClickTime = now;
    
    if (selectedNode) {
      detailPanel.classList.add('hidden');
      selectedNode = null;
      updateHighlights();
      updateURL();
    } else {
      if (delay < 350) {
        Graph.zoomToFit(1000, 50);
      }
    }
  });
  
  // Search Bar Auto-complete
  searchInput.addEventListener('input', (e) => {
    const text = e.target.value.toLowerCase().trim();
    if (text.length < 2) {
      searchSuggestions.classList.add('hidden');
      return;
    }
    
    // Find up to 5 matching nodes
    const matches = activeGraphData.nodes.filter(n => 
      n.name.toLowerCase().includes(text)
    ).slice(0, 5);
    
    if (matches.length === 0) {
      searchSuggestions.classList.add('hidden');
      return;
    }
    
    searchSuggestions.innerHTML = '';
    matches.forEach(node => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerText = node.name;
      div.addEventListener('click', () => {
        searchInput.value = node.name;
        searchSuggestions.classList.add('hidden');
        focusOnNodeByName(node.name);
      });
      searchSuggestions.appendChild(div);
    });
    
    searchSuggestions.classList.remove('hidden');
  });
  
  // Search button and Enter key trigger
  const executeSearch = () => {
    const query = searchInput.value.trim();
    if (query) {
      focusOnNodeByName(query);
      searchSuggestions.classList.add('hidden');
    }
  };
  
  searchBtn.addEventListener('click', executeSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
  });
  
  // Close suggestions if clicked outside
  document.addEventListener('click', (e) => {
    if (e.target !== searchInput) {
      searchSuggestions.classList.add('hidden');
    }
  });
  
  // Backspace key event listener for unselection and centering camera target
  document.addEventListener('keydown', (e) => {
    // Do not intercept backspace if the user is typing in the search box or other input elements
    if (document.activeElement && (
      document.activeElement.tagName === 'INPUT' || 
      document.activeElement.tagName === 'TEXTAREA' || 
      document.activeElement.isContentEditable
    )) {
      return;
    }
    
    if (e.key === 'Backspace') {
      if (selectedNode) {
        // Deselect current author
        detailPanel.classList.add('hidden');
        selectedNode = null;
        updateHighlights();
        updateURL();
      } else {
        // Smoothly zoom out and center the camera to frame the entire active graph nicely
        Graph.zoomToFit(1000, 50);
      }
    }
  });
  
  // Dynamic "Show Isolated Authors" toggle listener
  const showIsolatedChk = document.getElementById('show-isolated-chk');
  if (showIsolatedChk) {
    showIsolatedChk.addEventListener('change', () => {
      updateGraph();
    });
  }
  
  // Info Modal Dialog open/close listeners
  const infoBtn = document.getElementById('info-btn');
  const infoModal = document.getElementById('info-modal');
  const closeInfoBtn = document.getElementById('close-info-btn');
  
  if (infoBtn && infoModal) {
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      infoModal.classList.remove('hidden');
    });
  }
  
  if (closeInfoBtn && infoModal) {
    closeInfoBtn.addEventListener('click', () => {
      infoModal.classList.add('hidden');
    });
  }
  
  if (infoModal) {
    infoModal.addEventListener('click', (e) => {
      if (e.target === infoModal) {
        infoModal.classList.add('hidden');
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !infoModal.classList.contains('hidden')) {
        infoModal.classList.add('hidden');
      }
    });
  }
}

// Find a node by name, pan camera to it, and open its details
function focusOnNodeByName(name) {
  const targetNode = activeGraphData.nodes.find(n => 
    n.name.toLowerCase() === name.toLowerCase() || 
    n.name.toLowerCase().includes(name.toLowerCase())
  );
  
  if (targetNode) {
    handleNodeClick(targetNode);
    handleNodeHover(targetNode);
    setTimeout(() => {
      if (hoveredNode === targetNode) {
        handleNodeHover(null);
      }
    }, 3000);
  } else {
    alert(`Author "${name}" not found in current visible institutes.`);
  }
}
