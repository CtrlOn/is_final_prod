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
const highlightNodes = new Set();
const highlightLinks = new Set();

// Active filters
const activeInstitutes = new Set();

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
    const nodeSize = Math.sqrt(node.val) + 4;
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
      node.vx -= node.x * strength * alpha;
      node.vy -= node.y * strength * alpha;
      node.vz -= node.z * strength * alpha;
    });
  };
})());

// Fetch Data & Kickoff
Promise.all([
  fetch('network_data.json').then(res => res.json()),
  fetch('author_institutes.json').then(res => res.json()),
  fetch('publications.txt').then(res => res.text())
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
  const dynamicInstitutes = Array.from(institutesSet).sort();
  
  // Map dynamic institutes to TAB10_COLORS! (Requirement 7)
  dynamicInstitutes.forEach((inst, idx) => {
    INSTITUTE_COLORS[inst] = TAB10_COLORS[idx % TAB10_COLORS.length];
  });
  INSTITUTE_COLORS['DEFAULT'] = '#70a1ff';
  
  // Initialize activeInstitutes with all found institutes
  activeInstitutes.clear();
  dynamicInstitutes.forEach(inst => activeInstitutes.add(inst));
  
  // Parse publications into lines, removing empty rows
  publicationsList = pubsText.split('\n')
    .map(line => line.strip ? line.strip() : line.trim())
    .filter(line => line.length > 0);
  
  // Save full copies
  allGraphData.nodes.forEach(node => {
    node.val = Number(node.val) || 1;
  });
  
  // Build and render dynamic filter checkboxes! (Requirement 7)
  renderDynamicFilters(dynamicInstitutes);
  
  // Update state and render
  updateGraph();
  setupEventListeners();
  
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
    checkbox.checked = true;
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
  
  const nodeIds = new Set(filteredNodes.map(n => n.id));
  const filteredLinks = allGraphData.links.filter(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    return nodeIds.has(sourceId) && nodeIds.has(targetId);
  });
  
  activeGraphData = { nodes: filteredNodes, links: filteredLinks };
  Graph.graphData(activeGraphData);
  
  // Update overall UI stats
  statNodesCount.innerText = filteredNodes.length;
  statLinksCount.innerText = filteredLinks.length;
}

// Hover Event Handler
function handleNodeHover(node) {
  if (hoveredNode === node) return;
  
  highlightNodes.clear();
  highlightLinks.clear();
  
  if (node) {
    hoveredNode = node;
    highlightNodes.add(node);
    
    // Find all directly connected links and neighbors
    activeGraphData.links.forEach(link => {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      
      if (source === node.id) {
        highlightLinks.add(link);
        const neighbor = activeGraphData.nodes.find(n => n.id === target);
        if (neighbor) highlightNodes.add(neighbor);
      } else if (target === node.id) {
        highlightLinks.add(link);
        const neighbor = activeGraphData.nodes.find(n => n.id === source);
        if (neighbor) highlightNodes.add(neighbor);
      }
    });
  } else {
    hoveredNode = null;
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
       .linkColor(Graph.linkColor())
       .linkDirectionalParticles(Graph.linkDirectionalParticles());
}

// Click Event Handler
function handleNodeClick(node) {
  // Focus camera on clicked node
  const distance = 90;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
  Graph.cameraPosition(
    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, // camera coordinate
    node, // focal target (node position)
    1500  // transitions duration (ms)
  );
  
  // Open details panel
  openDetailPanel(node);
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
  const matches = [];
  const parser = new DOMParser();
  
  publicationsList.forEach(pubHtml => {
    const doc = parser.parseFromString(`<div>${pubHtml}</div>`, 'text/html');
    const authors = doc.querySelectorAll('author');
    
    let isMatch = false;
    authors.forEach(authEl => {
      const parsedName = normalizeAuthorName(authEl.textContent);
      if (parsedName.toLowerCase() === authorName.toLowerCase()) {
        isMatch = true;
      }
    });
    
    if (isMatch) {
      matches.push(pubHtml);
    }
  });
  
  return matches;
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
