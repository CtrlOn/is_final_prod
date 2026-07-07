import SpriteText from "https://esm.sh/three-spritetext";

// Tableau 10 Color Cycle Palette
const TAB10_COLORS = [
  '#1f77b4', // Blue
  '#ff7f0e', // Orange
  '#2ca02c', // Green
  '#d62728', // Red
  '#9467bd', // Purple
  '#8c564b', // Brown
  '#e377c2', // Pink
  '#7f7f7f', // Gray
  '#bcbd22', // Olive
  '#17becf'  // Cyan
];

// Institute Colors Mapping (Populated dynamically on data load)
const INSTITUTE_COLORS = {};

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
const authorInitials = document.getElementById('author-initials');
const authorName = document.getElementById('author-name');
const authorInstitutesContainer = document.getElementById('author-institutes');
const authorPubCount = document.getElementById('author-pub-count');
const authorCoauthorCount = document.getElementById('author-coauthor-count');
const authorPublications = document.getElementById('author-publications');

// Stats Elements
const statNodesCount = document.getElementById('stat-nodes-count');
const statLinksCount = document.getElementById('stat-links-count');

// Initialize 3D Force Graph
const Graph = ForceGraph3D()(document.getElementById('3d-graph'))
  .backgroundColor('#06060c')
  .showNavInfo(false)
  .nodeLabel(node => `<div class="scene-tooltip"><strong>${node.name}</strong><br/>${node.institutes.join(', ')} (${node.val} pubs)</div>`)
  .linkLabel(link => `<div class="scene-tooltip">Connection strength: <strong>${link.value}</strong></div>`)
  .linkWidth(link => highlightLinks.size === 0 || highlightLinks.has(link) ? Math.sqrt(Math.max(1, link.value) * 1.5) : 0.1)
  .linkColor(link => highlightLinks.size === 0 || highlightLinks.has(link) ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.1)')
  .onNodeHover(handleNodeHover)
  .onNodeClick(handleNodeClick)
  .nodeThreeObject(node => {
    const institutes = node.institutes || ['DEFAULT'];
    const group = new THREE.Group();
    
    // --- 1. BUILD THE 3D BALL (SPHERE) WITH MULTI-COLOR SECTIONS (Beach-ball style) ---
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
    
    const sphereTexture = new THREE.CanvasTexture(sphereCanvas);
    const nodeSize = Math.cbrt(node.val) * 3;
    const sphereGeom = new THREE.SphereGeometry(nodeSize, 32, 32);
    const sphereMat = new THREE.MeshBasicMaterial({
      map: sphereTexture,
      transparent: true,
      opacity: 1.0
    });
    
    const sphereMesh = new THREE.Mesh(sphereGeom, sphereMat);
    group.add(sphereMesh);
    
    // --- 2. BUILD THE FLOATING LABEL ---
    const sprite = new SpriteText(node.name);
    sprite.material.depthWrite = false; // make sprite background transparent
    const primaryInst = institutes[0] || 'DEFAULT';
    sprite.color = INSTITUTE_COLORS[primaryInst] || INSTITUTE_COLORS.DEFAULT;
    sprite.textHeight = 10;
    sprite.padding = 1;    // Add padding to prevent diacritics (e.g. Ž) from clipping
    sprite.center.y = -1.8 - nodeSize * 0.1; // shift above node
    
    // Disable raycasting on the sprite so hover events/tooltips only target the sphere!
    sprite.raycast = () => null;
    
    group.add(sprite);
    
    node.__mesh = group; // Save reference for opacities/hover highlights
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
Promise.all([
  fetch('network_data.json?v=' + Date.now()).then(res => res.json()),
  fetch('author_institutes.json?v=' + Date.now()).then(res => res.json()),
  fetch('publications.txt?v=' + Date.now()).then(res => res.text())
]).then(([networkData, institutes, pubsText]) => {
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
  
  // Initialize activeInstitutes with all found institutes
  activeInstitutes.clear();
  dynamicInstitutesList.forEach(inst => activeInstitutes.add(inst));
  
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
      // If bitmask has character and it's '1', include it. If bitmask is shorter, default to '1'.
      const char = instituteArg[idx];
      if (char === undefined || char === '1') {
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
  
  // Save full copies
  allGraphData.nodes.forEach(node => {
    node.val = Number(node.val) || 1;
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
  
  // If selected node is no longer in visible nodes, close details and deselect
  if (selectedNode && !nodeIds.has(selectedNode.id)) {
    detailPanel.classList.add('hidden');
    selectedNode = null;
  }
  
  activeGraphData = { nodes: finalNodes, links: filteredLinks };
  Graph.graphData(activeGraphData);
  
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
        const neighbor = activeGraphData.nodes.find(n => n.id === target);
        if (neighbor) highlightNodes.add(neighbor);
      } else if (target === activeNode.id) {
        highlightLinks.add(link);
        const neighbor = activeGraphData.nodes.find(n => n.id === source);
        if (neighbor) highlightNodes.add(neighbor);
      }
    });
  }
  
  // Dynamically update opacities of Three.js objects (traversing the node's rendering group)
  activeGraphData.nodes.forEach(n => {
    const obj = n.__threeObj || n.__mesh;
    if (obj) {
      const isHighlighted = highlightNodes.size === 0 || highlightNodes.has(n);
      const targetOpacity = isHighlighted ? 1.0 : 0.15;
      obj.traverse(child => {
        if (child.material) {
          child.material.transparent = true;
          child.material.opacity = targetOpacity;
        }
      });
    }
  });
  
  // Force link update
  Graph.linkWidth(Graph.linkWidth())
       .linkColor(Graph.linkColor());
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
  // Get initials
  const nameParts = node.name.split(' ');
  const initials = nameParts.map(p => p[0]).join('').substring(0, 3).toUpperCase();
  authorInitials.innerText = initials;
  
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
  
  authorPubCount.innerText = node.val;
  
  // Find co-authors count
  const uniqueCoauthors = new Set();
  allGraphData.links.forEach(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    if (sourceId === node.id) uniqueCoauthors.add(targetId);
    if (targetId === node.id) uniqueCoauthors.add(sourceId);
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
