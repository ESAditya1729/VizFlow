/**
 * VizFlow Workflow Builder — Complete JavaScript
 * 
 * Manages:
 * - Activity palette rendering with search and categories
 * - Canvas/step management with drag-and-drop
 * - Workflow execution with progress tracking
 * - File operations (new/open/save)
 * - Logging with levels and filtering
 * - VS Code message handling
 */

(function() {
  'use strict';

  // ─── CONSTANTS ──────────────────────────────────────────────────────────────

  const DEFAULT_WORKFLOW_NAME = 'My Workflow';
  const MAX_LOG_ENTRIES = 500;
  const PROGRESS_ANIMATION_DURATION = 300;

  // ─── CONFIRM DIALOG ────────────────────────────────────────────────────────
  // VS Code webviews block window.confirm(), so render a small modal instead.

  /**
   * Show a confirm dialog. Invokes onOk only when the user confirms.
   * @param {string} message
   * @param {() => void} onOk
   * @param {string} [okLabel]
   */
  function webviewConfirm(message, onOk, okLabel) {
    const overlay = document.createElement('div');
    overlay.className = 'params-modal-overlay';
    overlay.style.zIndex = '2000';
    overlay.innerHTML =
      '<div class="params-modal" style="width:min(420px,90vw);">' +
        '<div class="params-modal-body">' + message + '</div>' +
        '<div class="params-modal-footer">' +
          '<button type="button" class="btn-secondary" data-action="cancel">Cancel</button>' +
          '<button type="button" class="btn-primary" data-action="ok">' + (okLabel || 'OK') + '</button>' +
        '</div>' +
      '</div>';
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="ok"]').addEventListener('click', () => { overlay.remove(); onOk(); });
    document.body.appendChild(overlay);
  }

  // ─── STATE ──────────────────────────────────────────────────────────────────

  /** @type {Array<{type:string, displayName:string, category:string, description:string, configRequirements:Array}>} */
  let activities = [];

  /** @type {Array<{id:string, type:string, config:Object, collapsed:boolean, status:string, stats:Object, error:string|null}>} */
  let steps = [];

  let running = false;
  let stepCounter = 1;
  let currentFile = null;
  let currentActivityFilter = null;
  let logLevelFilter = 'all';
  let isLogCollapsed = false;
  /** @type {Array<{name:string, label:string, type:string, required:boolean, defaultValue:string}>} */
  let workflowParameters = [];

  /** Map of dynamic-option requestId → populate(options) callbacks */
  const dynamicRequests = new Map();
  let dynamicRequestCounter = 0;

  /** Guards duplicate connection-option refresh requests to the host. */
  let connectionOptionsPending = false;

  // ─── DOM REFS ────────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  const paletteList = $('paletteList');
  const paletteSearch = $('paletteSearch');
  const paletteCategories = $('paletteCategories');
  const searchClear = $('searchClear');
  const canvasEmpty = $('canvasEmpty');
  const canvasWrap = $('canvasWrap');
  const canvasContextMenu = $('canvasContextMenu');
  const nodeContextMenu = $('nodeContextMenu');
  const logPanel = $('logPanel');
  const logLevelFilterEl = $('logLevelFilter');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const workflowName = $('workflowName');
  const workflowStatus = $('workflowStatus');
  const fileInfo = $('fileInfo');
  const activityCount = $('activityCount');
  const notificationArea = $('notificationArea');
  const runTimer = $('runTimer');

  const btnRun = $('btnRun');
  const btnStop = $('btnStop');
  const btnNew = $('btnNew');
  const btnOpen = $('btnOpen');
  const btnSave = $('btnSave');
  const btnSaveAs = $('btnSaveAs');
  const btnSchedule = $('btnSchedule');
  const btnExport = $('btnExport');
  const btnClearLog = $('btnClearLog');
  const btnToggleLog = $('btnToggleLog');
  const btnSettings = $('btnSettings');
  const btnHelp = $('btnHelp');
  const btnTogglePalette = $('btnTogglePalette');
  const palette = $('palette');

  // Config panel refs
  const configPanel = $('configPanel');
  const configPanelBody = $('configPanelBody');
  const configPanelTitle = $('configPanelTitle');
  const configPanelIcon = $('configPanelIcon');
  const configPanelClose = $('configPanelClose');
  let configPanelNodeId = null;  // Currently editing node

  const vscode = acquireVsCodeApi();

  // ─── DAG STATE ─────────────────────────────────────────────────────────────
  // Visual DAG editor state for node-based workflow canvas.

  /** @type {Map<string, {id:string, type:string, displayName:string, notes:string, position:{x:number,y:number}, config:Object, status:string, stats:Object, error:string|null}>} */
  const dagNodes = new Map();

  /** @type {Map<string, {id:string, source:{nodeId:string, port:string}, target:{nodeId:string, port:string}, label?:string}>} */
  const dagEdges = new Map();

  /** @type {Set<string>} IDs of currently selected nodes */
  const dagSelectedNodes = new Set();

  /** @type {string|null} ID of currently selected edge */
  let dagSelectedEdge = null;

  /** Pan/zoom state */
  let dagViewBox = { x: 0, y: 0, width: 1200, height: 800 };
  let dagZoom = 1;
  let dagPanOffset = { x: 0, y: 0 };

  /** Interaction state */
  let dagDraggingNode = null;
  let dagDraggingOffset = { x: 0, y: 0 };
  let dagConnectingFrom = null;  // {nodeId, port, startX, startY}
  let dagSelectionBox = null;    // {startX, startY, endX, endY}
  let dagPanning = false;
  let dagPanStart = { x: 0, y: 0 };

  /** Cached canvas rect during drag operations (avoids getBoundingClientRect per frame) */
  let dagCachedCanvasRect = null;
  /** rAF id for batching connection drag updates */
  let dagConnectRafId = 0;
  /** Pending connection endpoint for the next rAF frame */
  let dagConnectPendingPos = null;

  /** Undo/redo stacks */
  let dagUndoStack = [];
  let dagRedoStack = [];
  const DAG_MAX_UNDO = 50;

  /** DOM refs for SVG elements */
  let dagCanvasEl = null;
  let dagTransformEl = null;
  let dagNodesEl = null;
  let dagEdgesEl = null;
  let dagTempConnectionEl = null;
  let dagMinimapEl = null;
  let dagMinimapContentEl = null;
  let dagMinimapViewportEl = null;
  let dagZoomLevelEl = null;

  /** Node dimensions */
  const DAG_NODE_WIDTH = 200;
  const DAG_NODE_HEIGHT = 80;
  const DAG_PORT_RADIUS = 6;

  /** Get the absolute canvas position of a port on a node. */
  function dagGetPortPosition(nodeId, port) {
    const node = dagNodes.get(nodeId);
    if (!node) return { x: 0, y: 0 };
    const x = node.position.x;
    const y = node.position.y;
    switch (port) {
      case 'then':  return { x: x + DAG_NODE_WIDTH, y: y + 25 };
      case 'else':  return { x: x + DAG_NODE_WIDTH, y: y + DAG_NODE_HEIGHT - 25 };
      case 'output': return { x: x + DAG_NODE_WIDTH, y: y + DAG_NODE_HEIGHT / 2 };
      case 'input':  return { x: x, y: y + DAG_NODE_HEIGHT / 2 };
      default:       return { x: x + DAG_NODE_WIDTH, y: y + DAG_NODE_HEIGHT / 2 };
    }
  }

  // ─── CATEGORY METADATA ──────────────────────────────────────────────────────

  const CAT = {
    'Input':          { color: '#2da680', bg: 'rgba(45,166,128,0.15)', icon: '📥', order: 0 },
    'Transformation': { color: '#7c6fde', bg: 'rgba(124,111,222,0.15)', icon: '⚙️', order: 1 },
    'Query':          { color: '#c97c2a', bg: 'rgba(201,124,42,0.15)',  icon: '🔍', order: 2 },
    'Analytics':      { color: '#c75f8a', bg: 'rgba(199,95,138,0.15)', icon: '📊', order: 3 },
    'Control':        { color: '#e07b39', bg: 'rgba(224,123,57,0.15)',  icon: '🔀', order: 4 },
    'Integration':    { color: '#2f8fb6', bg: 'rgba(47,143,182,0.15)', icon: '🌐', order: 5 },
    'Output':         { color: '#3a8fd4', bg: 'rgba(58,143,212,0.15)', icon: '📤', order: 6 },
  };

  const CAT_ORDER = ['Input', 'Transformation', 'Query', 'Analytics', 'Control', 'Integration', 'Output'];

  function catMeta(cat) {
    return CAT[cat] || { color: '#5a5b7a', bg: 'rgba(90,91,122,0.15)', icon: '▪', order: 999 };
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────────

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function defaultConfig(act) {
    const cfg = {};
    for (const req of (act.configRequirements || [])) {
      if ((req.type === 'select' || req.type === 'connection') && req.options?.length) {
        const first = req.options[0];
        cfg[req.name] = typeof first === 'string' ? first : first.value;
      } else if (req.type === 'multiAction') {
        cfg[req.name] = [{ column: '', opKey: req.operationOptions?.[0]?.value || '', params: '' }];
      } else if (req.type === 'file') {
        cfg[req.name] = '';
      } else if (req.type === 'boolean') {
        cfg[req.name] = req.defaultValue !== undefined ? req.defaultValue : true;
      } else if (req.type === 'number') {
        cfg[req.name] = req.defaultValue !== undefined ? req.defaultValue : 0;
      } else if (req.type === 'keyValue') {
        cfg[req.name] = {};
      } else {
        cfg[req.name] = req.defaultValue !== undefined ? req.defaultValue : '';
      }
    }
    // Block-specific sub-step arrays
    if (act.type === 'ifElse') {
      cfg.thenSteps = Array.isArray(cfg.thenSteps) ? cfg.thenSteps : [];
      cfg.elseSteps = Array.isArray(cfg.elseSteps) ? cfg.elseSteps : [];
    }
    if (act.type === 'forEach' || act.type === 'forEachFile') {
      cfg.steps = Array.isArray(cfg.steps) ? cfg.steps : [];
    }
    return cfg;
  }

  /** Serialize a step (including nested block children) for the workflow definition. */
  function serializeStep(s) {
    const cfg = { ...(s && s.config ? s.config : {}) };
    if (s && s.type === 'ifElse') {
      cfg.thenSteps = Array.isArray(s.config?.thenSteps) ? s.config.thenSteps.map(serializeStep) : [];
      cfg.elseSteps = Array.isArray(s.config?.elseSteps) ? s.config.elseSteps.map(serializeStep) : [];
    } else if (s && (s.type === 'forEach' || s.type === 'forEachFile')) {
      cfg.steps = Array.isArray(s.config?.steps) ? s.config.steps.map(serializeStep) : [];
    }
    const out = { id: s.id, type: s.type, config: cfg };
    if (s.displayName) out.displayName = s.displayName;
    if (s.notes) out.notes = s.notes;
    return out;
  }

  /**
   * BFS from a given node+port to collect all downstream node IDs.
   * Stops when a node has no outgoing edges from the given context.
   */
  function dagCollectBranch(startNodeId, startPort) {
    const visited = new Set();
    const queue = [];
    // Find the first edge from the start port
    for (const edge of dagEdges.values()) {
      if (edge.source.nodeId === startNodeId && edge.source.port === startPort) {
        queue.push(edge.target.nodeId);
      }
    }
    while (queue.length > 0) {
      const nid = queue.shift();
      if (visited.has(nid)) continue;
      visited.add(nid);
      // Follow any output edge from this node (port can be 'output', 'then', 'else')
      for (const edge of dagEdges.values()) {
        if (edge.source.nodeId === nid && !visited.has(edge.target.nodeId)) {
          // Stop at merge points: a node with incoming edges from outside this branch
          // (i.e. from a node NOT already in visited) is a merge point — include it
          // only if it hasn't been visited yet from another path within this branch.
          queue.push(edge.target.nodeId);
        }
      }
    }
    return visited;
  }

  function buildWorkflowDef() {
    const edges = [];
    for (const edge of dagEdges.values()) {
      edges.push({
        id: edge.id,
        source: { nodeId: edge.source.nodeId, port: edge.source.port },
        target: { nodeId: edge.target.nodeId, port: edge.target.port },
        label: edge.label || undefined
      });
    }

    // Derive thenSteps/elseSteps for ifElse nodes from port connections
    const branchNodeIds = new Set();
    const ifElseBranches = new Map(); // nodeId → { thenIds, elseIds }

    for (const step of steps) {
      if (step.type === 'ifElse') {
        const thenIds = dagCollectBranch(step.id, 'then');
        const elseIds = dagCollectBranch(step.id, 'else');
        ifElseBranches.set(step.id, { thenIds, elseIds });
        for (const id of thenIds) branchNodeIds.add(id);
        for (const id of elseIds) branchNodeIds.add(id);
      }
    }

    // Build the node map for quick lookup
    const nodeMap = new Map();
    for (const node of dagNodes.values()) {
      nodeMap.set(node.id, node);
    }

    // Helper: convert a set of node IDs into a serializable step array (topological order)
    function branchToSteps(idSet) {
      if (idSet.size === 0) return [];
      // Topological sort within the branch
      const ids = Array.from(idSet);
      const inBranch = new Set(ids);
      const result = [];
      const visited = new Set();
      function visit(nid) {
        if (visited.has(nid)) return;
        visited.add(nid);
        // Visit predecessors within the branch first
        for (const edge of dagEdges.values()) {
          if (edge.target.nodeId === nid && inBranch.has(edge.source.nodeId)) {
            visit(edge.source.nodeId);
          }
        }
        const node = nodeMap.get(nid);
        if (node) result.push(node);
      }
      for (const id of ids) visit(id);
      return result;
    }

    // Build top-level steps: exclude branch nodes, populate ifElse thenSteps/elseSteps
    const topLevelSteps = [];
    for (const step of steps) {
      if (branchNodeIds.has(step.id)) continue;
      if (step.type === 'ifElse' && ifElseBranches.has(step.id)) {
        const { thenIds, elseIds } = ifElseBranches.get(step.id);
        const cfg = { ...(step.config || {}) };
        cfg.thenSteps = branchToSteps(thenIds).map(serializeStep);
        cfg.elseSteps = branchToSteps(elseIds).map(serializeStep);
        const out = { id: step.id, type: step.type, config: cfg };
        if (step.displayName) out.displayName = step.displayName;
        if (step.notes) out.notes = step.notes;
        topLevelSteps.push(out);
      } else {
        topLevelSteps.push(serializeStep(step));
      }
    }

    return {
      name: workflowName.value.trim() || DEFAULT_WORKFLOW_NAME,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      parameters: workflowParameters.length ? workflowParameters.map(p => ({ ...p })) : undefined,
      activities: topLevelSteps,
      edges: edges.length > 0 ? edges : undefined
    };
  }

  /** Recursively normalize a list of raw activity objects into live step objects. */
  function normalizeSteps(rawList) {
    if (!Array.isArray(rawList)) return [];

    return rawList.map(a => {
      if (!a || typeof a !== 'object') return null;

      const act = activities.find(x => x.type === a.type);
      const defaults = act ? defaultConfig(act) : {};
      const cfg = { ...defaults, ...(a.config || {}) };
      // Recurse into nested blocks
      if (a.type === 'ifElse') {
        cfg.thenSteps = normalizeSteps(Array.isArray(a.config?.thenSteps) ? a.config.thenSteps : []);
        cfg.elseSteps = normalizeSteps(Array.isArray(a.config?.elseSteps) ? a.config.elseSteps : []);
      } else if (a.type === 'forEach' || a.type === 'forEachFile') {
        cfg.steps = normalizeSteps(Array.isArray(a.config?.steps) ? a.config.steps : []);
      }
      return { 
        id: a.id, 
        type: a.type, 
        config: cfg, 
        displayName: a.displayName || '',
        notes: a.notes || '',
        collapsed: false, 
        status: 'Pending', 
        stats: {}, 
        error: null 
      };
    }).filter(Boolean);
  }

  function loadWorkflowDef(def) {
    workflowName.value = def.name || DEFAULT_WORKFLOW_NAME;
    workflowParameters = Array.isArray(def.parameters)
      ? def.parameters.map(p => ({ ...p }))
      : [];
    steps = normalizeSteps(def.activities || []);
    // Find highest step counter across all steps (shallow + nested)
    let max = 0;
    function scanIds(list) {
      for (const s of list) {
        const m = s.id.match(/^step_(\d+)$/);
        if (m) max = Math.max(max, +m[1]);
        if (s.type === 'ifElse') {
          scanIds(s.config.thenSteps || []);
          scanIds(s.config.elseSteps || []);
        }
        if (s.type === 'forEach' || s.type === 'forEachFile') scanIds(s.config.steps || []);
      }
    }
    scanIds(steps);
    stepCounter = max + 1;

    // Initialize DAG nodes from loaded steps
    dagNodes.clear();
    dagEdges.clear();
    dagSelectedNodes.clear();
    dagSelectedEdge = null;

    // Collect all node IDs that belong to ifElse branches (will be flattened into DAG)
    const branchNodes = new Map(); // nodeId → step object (from nested thenSteps/elseSteps)
    const ifElsePortEdges = []; // { fromId, port, toId }

    function collectBranchNodes(ifElseStep) {
      const thenSteps = ifElseStep.config.thenSteps || [];
      const elseSteps = ifElseStep.config.elseSteps || [];
      // Connect ifElse → first thenStep
      if (thenSteps.length > 0) {
        ifElsePortEdges.push({ fromId: ifElseStep.id, port: 'then', toId: thenSteps[0].id });
      }
      // Connect consecutive thenSteps
      for (let i = 0; i < thenSteps.length - 1; i++) {
        ifElsePortEdges.push({ fromId: thenSteps[i].id, port: 'output', toId: thenSteps[i + 1].id });
      }
      // Connect ifElse → first elseStep
      if (elseSteps.length > 0) {
        ifElsePortEdges.push({ fromId: ifElseStep.id, port: 'else', toId: elseSteps[0].id });
      }
      // Connect consecutive elseSteps
      for (let i = 0; i < elseSteps.length - 1; i++) {
        ifElsePortEdges.push({ fromId: elseSteps[i].id, port: 'output', toId: elseSteps[i + 1].id });
      }
      // Recursively collect nested ifElse branches
      function registerBranch(list) {
        for (const s of list) {
          branchNodes.set(s.id, s);
          if (s.type === 'ifElse') collectBranchNodes(s);
          if (s.type === 'forEach' || s.type === 'forEachFile') registerBranch(s.config.steps || []);
        }
      }
      registerBranch(thenSteps);
      registerBranch(elseSteps);
    }

    for (const step of steps) {
      if (step.type === 'ifElse') collectBranchNodes(step);
      if (step.type === 'forEach' || step.type === 'forEachFile') {
        // forEach/forEachFile children stay nested (not flattened into DAG for now)
      }
    }

    // Create nodes with default positions (will be auto-laid-out)
    const nodeSpacing = 250;
    let nodeIndex = 0;
    function createNode(step) {
      const act = activities.find(a => a.type === step.type);
      return {
        id: step.id,
        type: step.type,
        displayName: step.displayName || (act ? act.displayName : step.type),
        notes: step.notes || '',
        position: { x: nodeIndex * nodeSpacing, y: 100 },
        config: step.config,
        status: step.status || 'Pending',
        stats: step.stats || {},
        error: step.error || null,
        preview: null
      };
    }

    // Create top-level nodes
    for (const step of steps) {
      const node = createNode(step);
      dagNodes.set(step.id, node);
      nodeIndex++;
    }

    // Create branch nodes (flattened from ifElse nested children)
    for (const [id, step] of branchNodes) {
      if (!dagNodes.has(id)) {
        const node = createNode(step);
        dagNodes.set(id, node);
        nodeIndex++;
      }
    }

    // Restore saved edges (from new-format files that include branch edges)
    const savedEdgeSet = new Set();
    if (Array.isArray(def.edges)) {
      for (const savedEdge of def.edges) {
        if (savedEdge && savedEdge.source && savedEdge.target) {
          dagEdges.set(savedEdge.id, {
            id: savedEdge.id,
            source: { nodeId: savedEdge.source.nodeId, port: savedEdge.source.port },
            target: { nodeId: savedEdge.target.nodeId, port: savedEdge.target.port },
            label: savedEdge.label || undefined
          });
          savedEdgeSet.add(`${savedEdge.source.nodeId}:${savedEdge.source.port}:${savedEdge.target.nodeId}`);
        }
      }
    }

    // For old-format files: create branch edges from nested thenSteps/elseSteps
    // (skip if edges already exist for these connections)
    for (const pe of ifElsePortEdges) {
      const key = `${pe.fromId}:${pe.port === 'output' ? 'output' : pe.port}:${pe.toId}`;
      if (!savedEdgeSet.has(key)) {
        const edgeId = `edge_branch_${pe.fromId}_${pe.port}_${pe.toId}`;
        dagEdges.set(edgeId, {
          id: edgeId,
          source: { nodeId: pe.fromId, port: pe.port === 'output' ? 'output' : pe.port },
          target: { nodeId: pe.toId, port: 'input' },
          label: undefined
        });
      }
    }

    // Auto-layout the nodes
    if (dagNodes.size > 0) {
      dagAutoLayout();
    } else {
      dagRenderAll();
    }

    updateFileInfo();
    renderCanvas();
  }

  // ─── NOTIFICATIONS ──────────────────────────────────────────────────────────

  function showNotification(message, type = 'info', duration = 3000) {
    notificationArea.classList.add('visible');
    notificationArea.innerHTML = `
      <div class="notification notification-${type}">
        <span>${esc(message)}</span>
      </div>
    `;
    
    clearTimeout(notificationArea._timeout);
    notificationArea._timeout = setTimeout(() => {
      notificationArea.classList.remove('visible');
      notificationArea.innerHTML = '';
    }, duration);
  }

  // ─── LOGGING ─────────────────────────────────────────────────────────────────

  function logLine(text, level = 'info') {
    // Check filter
    if (logLevelFilter !== 'all' && level !== logLevelFilter) return;

    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.innerHTML = `<span class="log-ts">${ts}</span>${esc(text)}`;
    
    const empty = logPanel.querySelector('.log-empty');
    if (empty) empty.remove();
    
    logPanel.appendChild(line);
    
    // Limit log entries
    while (logPanel.children.length > MAX_LOG_ENTRIES) {
      logPanel.removeChild(logPanel.firstChild);
    }
    
    logPanel.scrollTop = logPanel.scrollHeight;
    
    // Update status
    const statusText = document.querySelector('.log-status-text');
    if (statusText) {
      statusText.textContent = text.length > 50 ? text.slice(0, 50) + '…' : text;
    }
    const statusTime = document.querySelector('.log-status-time');
    if (statusTime) {
      statusTime.textContent = ts;
    }
  }

  function clearLog() {
    logPanel.innerHTML = `<div class="log-empty">Log cleared.</div>`;
    const statusText = document.querySelector('.log-status-text');
    if (statusText) statusText.textContent = 'Ready';
    const statusTime = document.querySelector('.log-status-time');
    if (statusTime) statusTime.textContent = '';
  }

  // ─── PALETTE ─────────────────────────────────────────────────────────────────

  function buildPalette(activityList) {
    const grouped = {};
    for (const act of activityList) {
      (grouped[act.category] = grouped[act.category] || []).push(act);
    }

    paletteList.innerHTML = '';

    for (const cat of CAT_ORDER) {
      if (!grouped[cat]) continue;
      const meta = catMeta(cat);
      const group = document.createElement('div');
      group.className = 'palette-group';

      const label = document.createElement('div');
      label.className = 'palette-group-label';
      label.style.color = meta.color;
      label.textContent = `${meta.icon} ${cat}`;
      group.appendChild(label);

      for (const act of grouped[cat]) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.draggable = true;
        item.title = act.description;
        item.dataset.type = act.type;

        const icon = document.createElement('div');
        icon.className = 'palette-item-icon';
        icon.style.background = meta.bg;
        icon.textContent = meta.icon;

        const text = document.createElement('div');
        text.className = 'palette-item-text';
        text.innerHTML = `
          <div class="palette-item-name">${esc(act.displayName)}</div>
          <div class="palette-item-desc">${esc(act.description || '')}</div>
        `;

        item.appendChild(icon);
        item.appendChild(text);
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('activity-type', act.type);
          e.dataTransfer.effectAllowed = 'copy';
          item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
        });
        item.addEventListener('click', () => addStep(act.type));
        group.appendChild(item);
      }
      paletteList.appendChild(group);
    }

    if (activityCount) {
      activityCount.textContent = activityList.length;
    }

    // Build category filters
    buildCategoryFilters(activityList);
  }

  function buildCategoryFilters(activityList) {
    const categories = new Set();
    for (const act of activityList) {
      categories.add(act.category);
    }

    paletteCategories.innerHTML = '';
    
    // All filter
    const allBtn = document.createElement('button');
    allBtn.className = 'category-filter active';
    allBtn.textContent = 'All';
    allBtn.dataset.category = 'all';
    allBtn.addEventListener('click', () => {
      document.querySelectorAll('.category-filter').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      currentActivityFilter = null;
      filterPalette(paletteSearch.value);
    });
    paletteCategories.appendChild(allBtn);

    for (const cat of CAT_ORDER) {
      if (!categories.has(cat)) continue;
      const btn = document.createElement('button');
      btn.className = 'category-filter';
      btn.textContent = catMeta(cat).icon + ' ' + cat;
      btn.dataset.category = cat;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.category-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentActivityFilter = cat;
        filterPalette(paletteSearch.value);
      });
      paletteCategories.appendChild(btn);
    }
  }

  function filterPalette(query) {
    const searchTerm = query.toLowerCase().trim();
    const items = document.querySelectorAll('.palette-item');
    
    items.forEach(item => {
      const name = item.querySelector('.palette-item-name')?.textContent?.toLowerCase() || '';
      const desc = item.querySelector('.palette-item-desc')?.textContent?.toLowerCase() || '';
      const type = item.dataset.type || '';
      
      const matchesSearch = name.includes(searchTerm) || desc.includes(searchTerm) || type.includes(searchTerm);
      const matchesCategory = !currentActivityFilter || 
        activities.find(a => a.type === type)?.category === currentActivityFilter;
      
      item.style.display = (matchesSearch && matchesCategory) ? '' : 'none';
    });

    // Show/hide empty groups
    document.querySelectorAll('.palette-group').forEach(group => {
      const visibleItems = group.querySelectorAll('.palette-item[style*="display: none"]');
      const totalItems = group.querySelectorAll('.palette-item').length;
      group.style.display = (visibleItems.length === totalItems) ? 'none' : '';
    });
  }

  // ─── CANVAS / STEPS ─────────────────────────────────────────────────────────

  function addStep(type) {
    const act = activities.find(a => a.type === type);
    if (!act) {
      showNotification(`Activity type "${type}" not found`, 'error');
      return;
    }
    
    // Calculate position for new node (center of visible canvas area)
    let x = 200, y = 200;
    if (dagCanvasEl) {
      const rect = dagCanvasEl.getBoundingClientRect();
      x = (rect.width / 2 - dagPanOffset.x) / dagZoom - DAG_NODE_WIDTH / 2;
      y = (rect.height / 2 - dagPanOffset.y) / dagZoom - DAG_NODE_HEIGHT / 2;
    }

    // dagAddNode handles adding to both dagNodes and steps
    dagAddNode(type, x, y);
  }

  function removeStep(id) {
    const step = steps.find(s => s.id === id);
    if (step) {
      const act = activities.find(a => a.type === step.type);
      if (act) {
        logLine(`Removed: ${act.displayName}`, 'info');
      }
    }
    steps = steps.filter(s => s.id !== id);
    // Also remove from DAG canvas
    if (dagNodes.has(id)) {
      dagRemoveNode(id);
    }
    renderCanvas();
  }

  function moveStep(id, dir) {
    const i = steps.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    renderCanvas();
  }

  function clearAllSteps() {
    if (steps.length === 0) return;
    webviewConfirm('Remove all activities from the workflow?', () => {
      steps = [];
      stepCounter = 1;
      // Also clear DAG canvas
      dagClearAll();
      renderCanvas();
      logLine('Cleared all steps', 'info');
    }, 'Remove');
  }

  // ─── CONFIG FIELD RENDERER ──────────────────────────────────────────────────

  function renderConfigFields(step, act, parentEl) {
    const configReqs = act.configRequirements || [];

    // ─── Dynamic option helpers (databases / collections / tables / columns) ─
    function dependenciesFor(req) {
      const deps = {};
      // Walk up the full dependency chain so the backend always receives
      // the connection name (needed to resolve the profile) plus every
      // intermediate value (database, table, …).
      const visited = new Set();
      let cur = req;
      while (cur && cur.dependsOn && !visited.has(cur.dependsOn)) {
        visited.add(cur.dependsOn);
        deps[cur.dependsOn] = step.config[cur.dependsOn];
        cur = configReqs.find(r => r.name === cur.dependsOn);
      }
      return deps;
    }

    function requestDynamicOptions(req, populate) {
      const requestId = ++dynamicRequestCounter;
      dynamicRequests.set(requestId, populate);
      vscode.postMessage({
        type: 'loadDynamicOptions',
        requestId,
        field: { name: req.name, dynamic: req.dynamic },
        dependencies: dependenciesFor(req)
      });
    }

    function refreshDependents(changedFieldName) {
      parentEl.querySelectorAll('.config-field').forEach((f) => {
        if (f.dataset.dependsOn === changedFieldName && f.__refreshDynamic) f.__refreshDynamic();
      });
    }

    function populateSelect(sel, options, currentVal) {
      sel.innerHTML = '';
      if (!options || options.length === 0) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = '— No options available —';
        sel.appendChild(o);
        return;
      }
      let found = false;
      for (const opt of options) {
        const o = document.createElement('option');
        const val = typeof opt === 'string' ? opt : (opt.value != null ? opt.value : opt);
        const lbl = typeof opt === 'string' ? opt : (opt.label != null ? opt.label : opt);
        o.value = val;
        o.textContent = lbl;
        if (String(val) === String(currentVal)) { o.selected = true; found = true; }
        sel.appendChild(o);
      }
      if (!found && currentVal != null && String(currentVal) !== '') {
        const o = document.createElement('option');
        o.value = currentVal;
        o.textContent = `${currentVal} (missing)`;
        sel.appendChild(o);
        sel.value = currentVal;
      }
      if (!sel.value && options.length > 0) sel.options[0].selected = true;
    }

    // Store reference to params field for dynamic updates
    let paramsField = null;
    let paramsInput = null;
    let paramsHint = null;

    for (const req of configReqs) {
      const field = document.createElement('div');
      field.className = 'config-field';
      field.dataset.reqName = req.name || '';

      const label = document.createElement('label');
      label.className = 'config-label';
      label.textContent = req.label || req.name;
      if (req.required) {
        const mark = document.createElement('span');
        mark.className = 'required-mark';
        mark.textContent = ' *';
        label.appendChild(mark);
      }
      field.appendChild(label);

      // ─── Multi-Action ──────────────────────────────────────────────────────
      if (req.type === 'multiAction') {
        if (!Array.isArray(step.config[req.name])) {
          step.config[req.name] = [{ 
            column: '', 
            opKey: req.operationOptions?.[0]?.value || '', 
            params: '' 
          }];
        }
        const actionList = step.config[req.name];
        const actionContainer = document.createElement('div');
        actionContainer.className = 'multi-action-container';

        const rebuildActions = () => {
          actionContainer.innerHTML = '';
          actionList.forEach((action, idx) => {
            const row = document.createElement('div');
            row.className = 'multi-action-row';

            const colInp = document.createElement('input');
            colInp.className = 'config-input multi-action-col';
            colInp.type = 'text';
            colInp.placeholder = 'Column…';
            colInp.value = action.column || '';
            colInp.addEventListener('input', () => { 
              action.column = colInp.value; 
            });

            const opSel = document.createElement('select');
            opSel.className = 'config-select multi-action-op';
            for (const opt of (req.operationOptions || [])) {
              const o = document.createElement('option');
              o.value = typeof opt === 'string' ? opt : opt.value;
              o.textContent = typeof opt === 'string' ? opt : opt.label;
              if (o.value === action.opKey) o.selected = true;
              opSel.appendChild(o);
            }
            if (!opSel.value && req.operationOptions?.length) {
              opSel.options[0].selected = true;
              action.opKey = opSel.value;
            }
            opSel.addEventListener('change', () => { 
              action.opKey = opSel.value;
            });

            const parInp = document.createElement('input');
            parInp.className = 'config-input multi-action-params';
            parInp.type = 'text';
            parInp.placeholder = 'Params (comma-sep)…';
            parInp.value = action.params || '';
            parInp.addEventListener('input', () => { 
              action.params = parInp.value; 
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-icon btn-remove-action';
            removeBtn.textContent = '−';
            removeBtn.title = 'Remove this action';
            removeBtn.style.color = '#c75f8a';
            removeBtn.addEventListener('click', () => {
              if (actionList.length > 1) { 
                actionList.splice(idx, 1); 
                rebuildActions(); 
              }
            });

            row.appendChild(colInp);
            row.appendChild(opSel);
            row.appendChild(parInp);
            row.appendChild(removeBtn);
            actionContainer.appendChild(row);
          });

          const addBtn = document.createElement('button');
          addBtn.className = 'btn-add-action';
          addBtn.textContent = '+ Add Action';
          addBtn.addEventListener('click', () => {
            actionList.push({ 
              column: '', 
              opKey: req.operationOptions?.[0]?.value || '', 
              params: '' 
            });
            rebuildActions();
          });
          actionContainer.appendChild(addBtn);
        };

        rebuildActions();
        field.appendChild(actionContainer);

      // ─── Boolean ──────────────────────────────────────────────────────────
      } else if (req.type === 'boolean') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'config-input';
        checkbox.checked = step.config[req.name] !== undefined ? step.config[req.name] : true;
        checkbox.addEventListener('change', () => {
          step.config[req.name] = checkbox.checked;
        });
        field.appendChild(checkbox);
        
        // Add label next to checkbox
        const cbLabel = document.createElement('span');
        cbLabel.style.marginLeft = '8px';
        cbLabel.style.fontSize = '12px';
        cbLabel.textContent = req.description || '';
        field.appendChild(cbLabel);

      // ─── Connection (saved data-source) ────────────────────────────────────
      } else if (req.type === 'connection') {
        const sel = document.createElement('select');
        sel.className = 'config-select';
        const options = req.options || [];
        if (options.length > 0) {
          const currentVal = step.config[req.name];
          for (const opt of options) {
            const o = document.createElement('option');
            const val = typeof opt === 'string' ? opt : (opt.value || opt);
            const lbl = typeof opt === 'string' ? opt : (opt.label || opt);
            o.value = val;
            o.textContent = lbl;
            if (val === currentVal) o.selected = true;
            sel.appendChild(o);
          }
          if (!sel.value && options.length > 0) {
            sel.options[0].selected = true;
            step.config[req.name] = sel.value;
          }
        } else {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = '— No saved connections — add one in VizFlow: Data Sources';
          sel.appendChild(o);
          if (!connectionOptionsPending) {
            connectionOptionsPending = true;
            vscode.postMessage({ type: 'loadConnectionOptions' });
          }
        }
        sel.addEventListener('change', () => {
          step.config[req.name] = sel.value;
          refreshDependents(req.name);
        });
        field.appendChild(sel);

      // ─── Select ────────────────────────────────────────────────────────────
      } else if (req.type === 'select') {
        const sel = document.createElement('select');
        sel.className = 'config-select';
        const options = req.options || [];
        
        // Store reference for params hint update
        if (req.name === 'opKey') {
          sel.dataset.opKeySelect = 'true';
        }
        
        if (options.length > 0) {
          const currentVal = step.config[req.name];
          for (const opt of options) {
            const o = document.createElement('option');
            const val = typeof opt === 'string' ? opt : (opt.value || opt);
            const lbl = typeof opt === 'string' ? opt : (opt.label || opt);
            o.value = val;
            o.textContent = lbl;
            // Store params hint as data attribute
            if (opt.paramsHint) {
              o.dataset.paramsHint = opt.paramsHint;
            }
            if (val === currentVal) o.selected = true;
            sel.appendChild(o);
          }
          if (!sel.value && options.length > 0) {
            sel.options[0].selected = true;
            step.config[req.name] = sel.value;
          }
        } else {
          const o = document.createElement('option');
          o.value = ''; 
          o.textContent = '— No options available —';
          sel.appendChild(o);
        }
        
        sel.addEventListener('change', () => { 
          step.config[req.name] = sel.value;
          // Update params hint if this is the operation selector
          if (req.name === 'opKey' && paramsField) {
            updateParamsHint(sel, paramsInput, paramsHint);
          }
          if (req.dynamic) refreshDependents(req.name);
        });

        // ─── Dynamic select (databases / collections / tables) ──────────────
        if (req.dynamic) {
          field.dataset.dynamic = 'true';
          field.dataset.dependsOn = req.dependsOn || '';

          const wrap = document.createElement('div');
          wrap.className = 'config-select-row';
          wrap.appendChild(sel);
          const reloadBtn = document.createElement('button');
          reloadBtn.className = 'btn-reload';
          reloadBtn.textContent = '⟳';
          reloadBtn.title = 'Reload options';
          reloadBtn.addEventListener('click', () => field.__refreshDynamic && field.__refreshDynamic());
          wrap.appendChild(reloadBtn);
          field.appendChild(wrap);

          field.__refreshDynamic = () => {
            requestDynamicOptions(req, (options) => {
              populateSelect(sel, options, step.config[req.name]);
              step.config[req.name] = sel.value;
              // Chain to dependents (e.g. database → collection) so auto-loaded
              // options still cascade instead of only the manual change event.
              refreshDependents(req.name);
            });
          };

          if (req.dependsOn && step.config[req.dependsOn]) field.__refreshDynamic();
        } else {
          field.appendChild(sel);
        }

      // ─── Columns (multi-select checkboxes) ────────────────────────────────
      } else if (req.type === 'columns') {
        field.dataset.dynamic = 'true';
        field.dataset.dependsOn = req.dependsOn || '';

        const header = document.createElement('div');
        header.className = 'columns-header';
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'btn-reload';
        reloadBtn.textContent = '⟳ Reload';
        reloadBtn.title = 'Reload columns';
        header.appendChild(reloadBtn);

        const container = document.createElement('div');
        container.className = 'columns-grid';

        const syncColumns = () => {
          const checked = Array.from(container.querySelectorAll('input.column-check:checked')).map((c) => c.value);
          step.config[req.name] = checked.join(', ');
        };

        const populate = (options) => {
          const cols = (options || []).map((o) => typeof o === 'string' ? o : o.value);
          const current = String(step.config[req.name] || '').split(',').map((s) => s.trim()).filter(Boolean);
          container.innerHTML = '';

          const allLabel = document.createElement('label');
          const allCheck = document.createElement('input');
          allCheck.type = 'checkbox';
          allCheck.className = 'column-check-all';
          allCheck.checked = cols.length > 0 && current.length === 0;
          allCheck.addEventListener('change', () => {
            container.querySelectorAll('input.column-check').forEach((c) => { c.checked = allCheck.checked; });
            syncColumns();
          });
          allLabel.appendChild(allCheck);
          allLabel.appendChild(document.createTextNode(' All fields'));
          container.appendChild(allLabel);

          if (cols.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'config-hint';
            hint.textContent = 'Pick ' + (req.dependsOn ? 'a ' + req.dependsOn : 'a source') + ' first to load columns.';
            container.appendChild(hint);
            return;
          }

          for (const col of cols) {
            const label = document.createElement('label');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'column-check';
            check.value = col;
            check.checked = current.includes(col);
            check.addEventListener('change', syncColumns);
            label.appendChild(check);
            label.appendChild(document.createTextNode(col));
            container.appendChild(label);
          }
        };

        field.__refreshDynamic = () => {
          requestDynamicOptions(req, populate);
        };
        reloadBtn.addEventListener('click', () => field.__refreshDynamic());

        field.appendChild(header);
        field.appendChild(container);

        if (req.dependsOn && step.config[req.dependsOn]) field.__refreshDynamic();

      // ─── File ──────────────────────────────────────────────────────────────
      } else if (req.type === 'file') {
        const row = document.createElement('div');
        row.className = 'config-file-row';
        const inp = document.createElement('input');
        inp.className = 'config-input';
        inp.type = 'text';
        inp.placeholder = req.description || req.placeholder || 'Path to file…';
        inp.value = step.config[req.name] ?? '';
        inp.addEventListener('input', () => { 
          step.config[req.name] = inp.value; 
        });
        const browse = document.createElement('button');
        browse.className = 'btn-browse';
        browse.textContent = '📂';
        browse.title = 'Browse for file';
        browse.addEventListener('click', () => {
          vscode.postMessage({ type: 'pickFile', stepId: step.id, field: req.name, activityType: step.type });
        });
        row.appendChild(inp);
        row.appendChild(browse);
        field.appendChild(row);

      // ─── Textarea ──────────────────────────────────────────────────────────
      } else if (req.type === 'text') {
        const textarea = document.createElement('textarea');
        textarea.className = 'config-textarea';
        textarea.placeholder = req.description || req.placeholder || '';
        textarea.value = step.config[req.name] ?? '';
        textarea.addEventListener('input', () => {
          step.config[req.name] = textarea.value;
        });
        field.appendChild(textarea);

      // ─── Object (structured JSON, e.g. filterModel) ─────────────────────────
      } else if (req.type === 'object') {
        const textarea = document.createElement('textarea');
        textarea.className = 'config-textarea config-json';
        textarea.placeholder = req.description || req.placeholder || 'Enter a JSON object…';
        const initial = step.config[req.name];
        textarea.value = (initial && typeof initial === 'object')
          ? JSON.stringify(initial, null, 2)
          : (initial != null ? String(initial) : '');

        const status = document.createElement('div');
        status.className = 'config-hint config-json-status';

        const sync = () => {
          const raw = textarea.value.trim();
          if (!raw) {
            step.config[req.name] = undefined;
            status.textContent = '';
            status.style.color = '';
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('Expected a JSON object');
            }
            step.config[req.name] = parsed;
            status.textContent = '✓ Valid JSON';
            status.style.color = 'var(--success, #2da680)';
          } catch (err) {
            step.config[req.name] = raw;
            status.textContent = '✗ ' + (err.message || 'Invalid JSON');
            status.style.color = 'var(--errorForeground, #f48771)';
          }
        };

        textarea.addEventListener('input', sync);
        sync();
        field.appendChild(textarea);
        field.appendChild(status);

      // ─── Params (Special Handling) ────────────────────────────────────────
      } else if (req.name === 'params') {
        // Store reference to params field
        paramsField = field;
        
        // Get the selected operation to show hint
        const opKey = step.config.opKey || '';
        let paramsHintText = 'none';
        
        // Find the operation in the config requirements
        if (act && act.configRequirements) {
          const opReq = act.configRequirements.find(r => r.name === 'opKey');
          if (opReq && opReq.options) {
            const selectedOp = opReq.options.find(o => o.value === opKey);
            if (selectedOp && selectedOp.paramsHint) {
              paramsHintText = selectedOp.paramsHint;
            }
          }
        }

        // Create input with hint
        const inp = document.createElement('input');
        inp.className = 'config-input';
        inp.type = 'text';
        if (paramsHintText !== 'none') {
          inp.placeholder = `e.g. ${paramsHintText}`;
        } else {
          inp.placeholder = 'No parameters needed';
        }
        inp.value = step.config[req.name] ?? '';
        inp.addEventListener('input', () => {
          step.config[req.name] = inp.value;
        });
        
        // Store reference to input
        paramsInput = inp;
        field.appendChild(inp);

        // Add hint below
        const hint = document.createElement('div');
        hint.className = 'config-hint';
        if (paramsHintText !== 'none') {
          hint.textContent = `💡 Parameters: ${paramsHintText}`;
          hint.style.color = 'var(--vscode-descriptionForeground)';
        } else {
          hint.textContent = '✅ No parameters required for this operation';
          hint.style.color = 'var(--success, #2da680)';
        }
        field.appendChild(hint);
        
        // Store reference to hint
        paramsHint = hint;

      // ─── Key/Value (object) ─────────────────────────────────────────────
      } else if (req.type === 'keyValue') {
        const entries = [];
        const raw = step.config[req.name];
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [k, v] of Object.entries(raw)) entries.push({ key: k, value: v });
        }
        const kvContainer = document.createElement('div');
        kvContainer.className = 'keyvalue-container';

        const syncKv = () => {
          const obj = {};
          for (const e of entries) {
            if (e.key && e.key.trim()) obj[e.key.trim()] = e.value;
          }
          step.config[req.name] = obj;
        };

        const rebuildKv = () => {
          kvContainer.innerHTML = '';
          entries.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'keyvalue-row';
            const kInp = document.createElement('input');
            kInp.className = 'config-input keyvalue-key';
            kInp.type = 'text';
            kInp.placeholder = 'Name';
            kInp.value = entry.key || '';
            kInp.addEventListener('input', () => { entry.key = kInp.value; syncKv(); });
            const vInp = document.createElement('input');
            vInp.className = 'config-input keyvalue-value';
            vInp.type = 'text';
            vInp.placeholder = 'Value ({{variable}} ok)';
            vInp.value = entry.value !== undefined && entry.value !== null ? String(entry.value) : '';
            vInp.addEventListener('input', () => { entry.value = vInp.value; syncKv(); });
            const del = document.createElement('button');
            del.className = 'btn-icon btn-remove-action';
            del.textContent = '−';
            del.title = 'Remove entry';
            del.style.color = '#c75f8a';
            del.addEventListener('click', () => { entries.splice(idx, 1); rebuildKv(); syncKv(); });
            row.appendChild(kInp); row.appendChild(vInp); row.appendChild(del);
            kvContainer.appendChild(row);
          });
          const addBtn = document.createElement('button');
          addBtn.className = 'btn-add-action';
          addBtn.textContent = '+ Add';
          addBtn.addEventListener('click', () => { entries.push({ key: '', value: '' }); rebuildKv(); syncKv(); });
          kvContainer.appendChild(addBtn);
        };

        rebuildKv();
        field.appendChild(kvContainer);

      // ─── Other Fields ──────────────────────────────────────────────────────
      } else {
        const inp = document.createElement('input');
        inp.className = 'config-input';
        inp.type = req.type === 'number' ? 'number' : 'text';
        inp.placeholder = req.description || req.placeholder || '';
        inp.value = step.config[req.name] ?? '';
        inp.addEventListener('input', () => {
          step.config[req.name] = req.type === 'number' ? parseFloat(inp.value) || 0 : inp.value;
        });
        field.appendChild(inp);
      }

      // ─── Add description as hint for all fields (EXCEPT params) ───────────
      if (req.description && 
          req.type !== 'file' && 
          req.type !== 'multiAction' && 
          req.type !== 'boolean' &&
          req.type !== 'text' &&
          req.name !== 'params') {
        const hint = document.createElement('div');
        hint.className = 'config-hint';
        hint.textContent = req.description;
        field.appendChild(hint);
      }

      parentEl.appendChild(field);
    }

    // ─── Helper function to update params hint ──────────────────────────────
    function updateParamsHint(opKeySelect, paramsInputEl, paramsHintEl) {
      if (!opKeySelect || !paramsInputEl || !paramsHintEl) return;
      
      const selectedOp = opKeySelect.value;
      const selectedOption = opKeySelect.querySelector(`option[value="${selectedOp}"]`);
      
      if (selectedOption) {
        const hintText = selectedOption.dataset.paramsHint || 'none';
        
        if (hintText !== 'none') {
          paramsHintEl.textContent = `💡 Parameters: ${hintText}`;
          paramsHintEl.style.color = 'var(--vscode-descriptionForeground)';
          paramsInputEl.placeholder = `e.g. ${hintText}`;
        } else {
          paramsHintEl.textContent = '✅ No parameters required for this operation';
          paramsHintEl.style.color = 'var(--success, #2da680)';
          paramsInputEl.placeholder = 'No parameters needed';
        }
      }
    }
  }

  // ─── CANVAS ──────────────────────────────────────────────────────────────────

  function renderCanvas() {
    canvasEmpty.classList.toggle('visible', steps.length === 0);
    dagRenderAll();
  }

  // ─── UPDATE FUNCTIONS ──────────────────────────────────────────────────────

  function updateStatus() {
    if (running) {
      workflowStatus.className = 'workflow-status status-running';
      workflowStatus.textContent = '● Running';
    } else if (steps.some(s => s.status === 'Failed')) {
      workflowStatus.className = 'workflow-status status-failed';
      workflowStatus.textContent = '● Failed';
    } else if (steps.length > 0 && steps.every(s => s.status === 'Completed')) {
      workflowStatus.className = 'workflow-status status-completed';
      workflowStatus.textContent = '● Completed';
    } else if (steps.length > 0) {
      workflowStatus.className = 'workflow-status status-ready';
      workflowStatus.textContent = '● Ready';
    } else {
      workflowStatus.className = 'workflow-status status-ready';
      workflowStatus.textContent = '● Empty';
    }
  }

  function updateFileInfo() {
    if (currentFile) {
      const fileName = currentFile.split(/[\\/]/).pop();
      fileInfo.textContent = `📄 ${fileName}`;
      fileInfo.title = currentFile;
    } else {
      fileInfo.textContent = '💾 Unsaved';
      fileInfo.title = 'Workflow not saved';
    }
  }

  // ─── CANVAS DRAG AND DROP ──────────────────────────────────────────────────
  // Old canvasWrap drop handler removed — dagCanvas handles drops via dagOnCanvasDrop.
  // Keep dragover for the visual border feedback.
  canvasWrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasWrap.style.borderColor = 'var(--vscode-focusBorder, #007fd4)';
  });

  canvasWrap.addEventListener('dragleave', (e) => {
    canvasWrap.style.borderColor = '';
  });

  // ─── CONTEXT MENU ──────────────────────────────────────────────────────────

  canvasWrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const menu = canvasContextMenu;
    menu.style.display = 'block';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
  });

  document.addEventListener('click', (e) => {
    if (!canvasContextMenu.contains(e.target)) {
      canvasContextMenu.style.display = 'none';
    }
  });

  canvasContextMenu.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    canvasContextMenu.style.display = 'none';
    
    switch (action) {
      case 'addActivity':
        // Focus search in palette
        paletteSearch.focus();
        break;
      case 'selectAll':
        // Visual feedback only
        showNotification('Select All - use Ctrl+A', 'info', 1500);
        break;
      case 'clearAll':
        clearAllSteps();
        break;
      case 'paste':
        // Placeholder for paste functionality
        showNotification('Paste not yet implemented', 'info', 1500);
        break;
    }
  });

  // ─── NODE CONTEXT MENU ─────────────────────────────────────────────────────

  let nodeContextMenuTarget = null;

  function showNodeContextMenu(e, nodeId) {
    nodeContextMenuTarget = nodeId;
    const menu = nodeContextMenu;
    menu.style.display = 'block';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px';
    e.preventDefault();
    e.stopPropagation();
  }

  document.addEventListener('click', (e) => {
    if (!nodeContextMenu.contains(e.target)) {
      nodeContextMenu.style.display = 'none';
      nodeContextMenuTarget = null;
    }
  });

  nodeContextMenu.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    const targetId = nodeContextMenuTarget;
    nodeContextMenu.style.display = 'none';
    nodeContextMenuTarget = null;

    if (!targetId) return;
    const node = dagNodes.get(targetId);
    if (!node) return;

    switch (action) {
      case 'editNotes': {
        openConfigPanel(targetId);
        // Focus the notes textarea after panel opens
        setTimeout(() => {
          const notesArea = configPanelBody.querySelector('textarea');
          if (notesArea) notesArea.focus();
        }, 50);
        break;
      }
      case 'previewData':
        if (node.preview) {
          showDataPreview(node);
        } else {
          showNotification('No data preview available. Run the workflow first.', 'info', 2000);
        }
        break;
      case 'renameNode': {
        openConfigPanel(targetId);
        setTimeout(() => {
          const nameInput = configPanelBody.querySelector('input[type="text"]');
          if (nameInput) nameInput.focus();
        }, 50);
        break;
      }
      case 'duplicateNode': {
        const act = activities.find(a => a.type === node.type);
        if (act) {
          dagAddNode(node.type, node.position.x + 40, node.position.y + 40);
          showNotification(`Duplicated "${node.displayName}"`, 'success', 1500);
        }
        break;
      }
      case 'deleteNode':
        dagRemoveNode(targetId);
        break;
    }
  });

  // ─── INLINE VALIDATION ─────────────────────────────────────────────────────

  function getActivityDef(type) {
    return activities.find(a => a.type === type) || null;
  }

  /** Recursively find a step (top-level or nested) by id. */
  function findStepById(list, id) {
    for (const s of list) {
      if (s.id === id) return s;
      if (s.type === 'ifElse') {
        const found = findStepById(s.config.thenSteps || [], id) || findStepById(s.config.elseSteps || [], id);
        if (found) return found;
      } else if (s.type === 'forEach' || s.type === 'forEachFile') {
        const found = findStepById(s.config.steps || [], id);
        if (found) return found;
      }
    }
    return null;
  }

  function isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  /** Auto-fill any empty `connection`-type config with the first saved option
   *  so a step can never fail validation when connections exist. */
  function autoFillConnections(list) {
    for (const step of list) {
      const act = getActivityDef(step.type);
      if (act && act.configRequirements) {
        for (const req of act.configRequirements) {
          if (req.type === 'connection' && isEmptyValue(step.config && step.config[req.name])) {
            const options = req.options || [];
            if (options.length > 0) {
              const first = options[0];
              step.config[req.name] = typeof first === 'string' ? first : first.value;
            }
          }
        }
      }
      if (step.type === 'ifElse') {
        autoFillConnections(step.config.thenSteps || []);
        autoFillConnections(step.config.elseSteps || []);
      } else if (step.type === 'forEach' || step.type === 'forEachFile') {
        autoFillConnections(step.config.steps || []);
      }
    }
  }

  /** Walk a step list (including nested branches) and return the first step
   *  with a missing required config field. */
  function firstInvalidStep(list) {
    for (const step of list) {
      const act = getActivityDef(step.type);
      if (act) {
        for (const req of (act.configRequirements || [])) {
          if (req.required && isEmptyValue(step.config && step.config[req.name])) {
            return { step, field: req.name, label: req.label || req.name };
          }
        }
      }
      if (step.type === 'ifElse') {
        const t = firstInvalidStep(step.config.thenSteps || []);
        if (t) return t;
        const e = firstInvalidStep(step.config.elseSteps || []);
        if (e) return e;
      } else if (step.type === 'forEach' || step.type === 'forEachFile') {
        const d = firstInvalidStep(step.config.steps || []);
        if (d) return d;
      }
    }
    return null;
  }

  function highlightInvalidField(step, fieldName) {
    // DAG canvas: select the node and open config panel to highlight the field
    dagSelectedNodes.clear();
    dagSelectedNodes.add(step.id);
    dagUpdateSelectionVisuals();
    openConfigPanel(step.id);

    // Try to highlight the specific field in the config panel
    setTimeout(() => {
      const fieldEl = document.querySelector(`.config-field[data-req-name="${CSS.escape(fieldName)}"]`);
      if (fieldEl) {
        fieldEl.classList.add('config-field-invalid');
        fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = fieldEl.querySelector('input, select, textarea');
        if (input) input.focus({ preventScroll: true });
      }
    }, 100);
  }

  // ─── RUN / STOP ────────────────────────────────────────────────────────────

  let runStartTime = 0;
  let timerInterval = null;

  function setRunning(r) {
    running = r;
    btnRun.style.display = r ? 'none' : '';
    btnStop.style.display = r ? '' : 'none';
    runTimer.style.display = r ? '' : 'none';
    
    if (r) {
      runStartTime = Date.now();
      timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - runStartTime) / 1000);
        runTimer.textContent = `⏱ ${elapsed}s`;
      }, 1000);
      workflowStatus.className = 'workflow-status status-running';
      workflowStatus.textContent = '● Running';
    } else {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      runTimer.textContent = '';
      if (!progressFill.style.width || progressFill.style.width === '0%') {
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
      }
      updateStatus();
    }
  }

  btnRun.addEventListener('click', () => {
    if (steps.length === 0) {
      logLine('No steps to run.', 'warn');
      showNotification('No steps to run', 'warning', 2000);
      return;
    }
    // Seed any empty connection fields from the first available option so
    // validation never reports a missing connection when connections exist.
    autoFillConnections(steps);

    const invalid = firstInvalidStep(steps);
    if (invalid) {
      const msg = `Missing required field "${invalid.label}" in step "${invalid.step.id}"`;
      logLine(msg, 'error');
      showNotification(msg, 'warning', 3000);
      renderCanvas();
      highlightInvalidField(invalid.step, invalid.field);
      return;
    }
    steps.forEach(s => { s.status = 'Pending'; s.stats = {}; s.error = null; });
    renderCanvas();
    setRunning(true);
    logLine('─── Running workflow ───', 'info');
    vscode.postMessage({ type: 'run', workflow: buildWorkflowDef() });
  });

  btnStop.addEventListener('click', () => {
    logLine('Stop requested — current step will complete.', 'warn');
    setRunning(false);
    vscode.postMessage({ type: 'stop' });
  });

  // ─── FILE OPERATIONS ──────────────────────────────────────────────────────

  btnNew.addEventListener('click', () => {
    const doNew = () => {
      steps = [];
      stepCounter = 1;
      currentFile = null;
      workflowName.value = DEFAULT_WORKFLOW_NAME;
      updateFileInfo();
      renderCanvas();
      logLine('New workflow created.', 'info');
      showNotification('New workflow created', 'success', 1500);
    };
    if (steps.length > 0) {
      webviewConfirm('Discard current workflow and start new?', doNew);
    } else {
      doNew();
    }
  });

  btnSave.addEventListener('click', () => {
    vscode.postMessage({ type: 'save', workflow: buildWorkflowDef(), filePath: currentFile });
  });

  btnSaveAs.addEventListener('click', () => {
    vscode.postMessage({ type: 'saveAs', workflow: buildWorkflowDef() });
  });

  btnOpen.addEventListener('click', () => {
    vscode.postMessage({ type: 'open' });
  });

  btnSchedule.addEventListener('click', () => {
    if (!currentFile) {
      logLine('Save the workflow first before scheduling it.', 'warn');
      showNotification('Please save the workflow first', 'warning', 2000);
      return;
    }
    vscode.postMessage({ type: 'scheduleWorkflow', filePath: currentFile });
  });

  btnExport.addEventListener('click', () => {
    const def = buildWorkflowDef();
    const json = JSON.stringify(def, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.name || 'workflow'}.vizflow.json`;
    a.click();
    URL.revokeObjectURL(url);
    logLine('Exported workflow as JSON', 'success');
    showNotification('Workflow exported successfully', 'success', 1500);
  });

  btnClearLog.addEventListener('click', clearLog);

  btnToggleLog.addEventListener('click', () => {
    const container = document.querySelector('.log-container');
    isLogCollapsed = !isLogCollapsed;
    if (isLogCollapsed) {
      container.style.maxHeight = '0px';
      container.style.overflow = 'hidden';
      btnToggleLog.textContent = '▸';
    } else {
      container.style.maxHeight = '200px';
      container.style.overflow = '';
      btnToggleLog.textContent = '▾';
    }
  });

  // Log level filter
  logLevelFilterEl.addEventListener('change', () => {
    logLevelFilter = logLevelFilterEl.value;
    // Re-render log with filter
    const lines = logPanel.querySelectorAll('.log-line');
    lines.forEach(line => {
      const level = line.className.replace('log-line ', '');
      line.style.display = (logLevelFilter === 'all' || level === logLevelFilter) ? '' : 'none';
    });
  });

  // Search clear
  searchClear.addEventListener('click', () => {
    paletteSearch.value = '';
    searchClear.style.display = 'none';
    filterPalette('');
  });

  paletteSearch.addEventListener('input', () => {
    const query = paletteSearch.value;
    searchClear.style.display = query ? '' : 'none';
    filterPalette(query);
  });

  // ─── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter or Cmd+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!running) btnRun.click();
    }
    // Ctrl+S or Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      btnSave.click();
    }
    // Ctrl+O or Cmd+O
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      btnOpen.click();
    }
    // Ctrl+N or Cmd+N
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      btnNew.click();
    }
    // Escape
    if (e.key === 'Escape') {
      canvasContextMenu.style.display = 'none';
    }
  });

  // ─── VS CODE MESSAGES ──────────────────────────────────────────────────────

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {

      case 'init':
        activities = msg.activities || [];
        buildPalette(activities);
        if (msg.workflow) {
          loadWorkflowDef(msg.workflow);
          currentFile = msg.filePath || null;
          updateFileInfo();
          logLine(`Opened: ${msg.filePath || 'untitled'}`, 'info');
        } else {
          renderCanvas();
          logLine('Ready — build your workflow!', 'info');
        }
        break;

      case 'activityState': {
        const step = findStepById(steps, msg.activityId);
        if (!step) break;
        step.status = msg.state;
        step.stats = msg.stats || step.stats;
        step.error = msg.error || null;
        // Also sync the DAG node state so the canvas reflects status changes
        const dagNode = dagNodes.get(msg.activityId);
        if (dagNode) {
          dagNode.status = step.status;
          dagNode.stats = step.stats;
          dagNode.error = step.error;
          // Store dataset preview if provided
          if (msg.stats && msg.stats.preview) {
            dagNode.preview = msg.stats.preview;
          }
        }
        dagRenderAll();
        renderCanvas();
        const sym = { Completed: '✓', Failed: '✗', Running: '…' }[msg.state] || '·';
        const level = msg.state === 'Failed' ? 'error' : msg.state === 'Completed' ? 'success' : 'info';
        logLine(`${sym} ${msg.activityId} → ${msg.state}${msg.error ? ': ' + msg.error : ''}`, level);
        break;
      }

      case 'runComplete':
        setRunning(false);
        progressFill.style.width = '100%';
        progressText.textContent = '100%';
        setTimeout(() => { 
          progressFill.style.width = '0%';
          progressText.textContent = '0%';
        }, PROGRESS_ANIMATION_DURATION * 2);
        
        // Display variables if they exist
        if (msg.variables && Object.keys(msg.variables).length > 0) {
          logLine('📦 Variables created:', 'info');
          
          const systemVars = ['workflowName', 'timestamp', 'workspaceRoot', 'date', 'time', 'year', 'month', 'day', 'hour', 'minute', 'second'];
          const userVars = Object.keys(msg.variables).filter(k => !systemVars.includes(k));
          
          // Show system variables first
          const sysVarEntries = Object.entries(msg.variables).filter(([k]) => systemVars.includes(k));
          if (sysVarEntries.length > 0) {
            for (const [key, value] of sysVarEntries) {
              const valStr = typeof value === 'object' 
                ? JSON.stringify(value).slice(0, 100) + (JSON.stringify(value).length > 100 ? '…' : '')
                : String(value);
              logLine(`  🔧 ${key} = ${valStr}`, 'info');
            }
          }
          
          // Show user variables
          if (userVars.length > 0) {
            for (const key of userVars) {
              const value = msg.variables[key];
              const valStr = typeof value === 'object' 
                ? JSON.stringify(value, null, 2).slice(0, 200) + (JSON.stringify(value).length > 200 ? '…' : '')
                : String(value);
              
              if (typeof value === 'object' && value !== null) {
                const summary = `(${Object.keys(value).length} keys)`;
                logLine(`  📊 ${key} = ${summary}`, 'info');
                const firstKeys = Object.keys(value).slice(0, 5);
                for (const subKey of firstKeys) {
                  const subVal = typeof value[subKey] === 'object' 
                    ? JSON.stringify(value[subKey]).slice(0, 50) + '…'
                    : String(value[subKey]);
                  logLine(`    └─ ${subKey}: ${subVal}`, 'info');
                }
                if (Object.keys(value).length > 5) {
                  logLine(`    └─ ... and ${Object.keys(value).length - 5} more`, 'info');
                }
              } else {
                logLine(`  📌 ${key} = ${valStr}`, 'info');
              }
            }
          }
        }
        
        logLine(msg.success ? '─── ✅ Completed ───' : `─── ❌ Failed: ${msg.error} ───`,
                msg.success ? 'success' : 'error');
        
        if (msg.success) {
          showNotification('Workflow completed successfully!', 'success', 2500);
        } else {
          showNotification(`Workflow failed: ${msg.error}`, 'error', 4000);

          // Failure report from the run trace + jump to the first failed step
          const failedEntries = (msg.trace || []).filter(t => t.state === 'Failed' && t.error);
          if (failedEntries.length > 0) {
            logLine(`─── ${failedEntries.length} failed step(s) ───`, 'error');
            for (const t of failedEntries) {
              logLine(`  ✗ ${t.activityId}: ${t.error}`, 'error');
            }
            const firstId = failedEntries[0].activityId;
            const card = document.querySelector(`.activity-card[data-step-id="${CSS.escape(firstId)}"]`);
            if (card) {
              card.classList.remove('collapsed');
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
        break;

      case 'runProgress':
        progressFill.style.width = (msg.pct || 0) + '%';
        progressText.textContent = (msg.pct || 0) + '%';
        break;

      case 'saved':
        currentFile = msg.filePath;
        updateFileInfo();
        logLine(`Saved → ${msg.filePath}`, 'success');
        showNotification(`Workflow saved: ${msg.filePath.split(/[\\/]/).pop()}`, 'success', 1500);
        break;

      case 'savedAs':
        currentFile = msg.filePath;
        updateFileInfo();
        logLine(`Saved → ${msg.filePath}`, 'success');
        showNotification(`Workflow saved as: ${msg.filePath.split(/[\\/]/).pop()}`, 'success', 1500);
        break;

      case 'opened':
        currentFile = msg.filePath;
        if (msg.workflow) {
          loadWorkflowDef(msg.workflow);
          updateFileInfo();
          logLine(`Opened: ${msg.filePath}`, 'success');
          showNotification(`Opened: ${msg.filePath.split(/[\\/]/).pop()}`, 'success', 1500);
        }
        break;

      case 'pickFileResult': {
        const step = findStepById(steps, msg.stepId);
        if (step && msg.filePath) {
          step.config[msg.field] = msg.filePath;
          // Update config panel input if it's open for this step
          dagSyncConfigPanelField(msg.stepId, msg.field, msg.filePath);
          renderCanvas();
        }
        break;
      }

      case 'dynamicOptions': {
        const populate = dynamicRequests.get(msg.requestId);
        if (populate) {
          dynamicRequests.delete(msg.requestId);
          if (msg.field) {
            console.log(`[VizFlow] dynamicOptions "${msg.field}" → ${(msg.options || []).length}`, msg.options || []);
          }
          populate(msg.options || []);
        }
        break;
      }

      case 'connectionOptions': {
        connectionOptionsPending = false;
        const opts = Array.isArray(msg.options) ? msg.options : [];
        let changed = false;
        for (const act of activities) {
          for (const req of (act.configRequirements || [])) {
            if (req.type === 'connection') {
              if (!Array.isArray(req.options) || req.options.length !== opts.length) changed = true;
              req.options = opts;
            }
          }
        }
        if (changed) renderCanvas();
        break;
      }

      case 'error':
        setRunning(false);
        logLine(`Error: ${msg.message}`, 'error');
        showNotification(`Error: ${msg.message}`, 'error', 4000);
        break;

      case 'runStopped':
        setRunning(false);
        logLine('Run stopped — no active run.', 'warn');
        break;

      default:
        console.warn('Unknown message type:', msg.type);
    }
  });

  // ─── WORKFLOW PARAMETERS MODAL ─────────────────────────────────────────────

  const paramsBtn = document.createElement('button');
  paramsBtn.className = 'btn-icon header-btn';
  paramsBtn.id = 'btnParameters';
  paramsBtn.title = 'Workflow Parameters';
  paramsBtn.textContent = '🧩';
  document.querySelector('.header-actions').insertBefore(paramsBtn, btnSettings);

  let paramsModal = null;

  function openParamsModal() {
    closeParamsModal();
    const overlay = document.createElement('div');
    overlay.className = 'params-modal-overlay';
    overlay.id = 'paramsModal';

    const modal = document.createElement('div');
    modal.className = 'params-modal';
    modal.appendChild(modalEl('header', '🧩 Workflow Parameters'));

    const body = document.createElement('div');
    body.className = 'params-modal-body';

    const rebuild = () => {
      body.innerHTML = '';
      workflowParameters.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'params-row';

        const nameInp = input('Name', p.name || '', v => { p.name = v; });
        nameInp.placeholder = 'paramName';
        const labelInp = input('Label', p.label || '', v => { p.label = v; });
        labelInp.placeholder = 'Display label';

        const typeSel = document.createElement('select');
        typeSel.className = 'config-select';
        for (const t of ['string', 'number', 'boolean', 'array', 'object']) {
          const o = document.createElement('option');
          o.value = t; o.textContent = t;
          if (t === (p.type || 'string')) o.selected = true;
          typeSel.appendChild(o);
        }
        typeSel.addEventListener('change', () => { p.type = typeSel.value; });

        const reqChk = document.createElement('input');
        reqChk.type = 'checkbox';
        reqChk.title = 'Required';
        reqChk.checked = !!p.required;
        reqChk.addEventListener('change', () => { p.required = reqChk.checked; });

        const defInp = input('Default', p.defaultValue !== undefined && p.defaultValue !== null ? String(p.defaultValue) : '', v => { p.defaultValue = v; });
        defInp.placeholder = 'Default ({{var}} ok)';

        const del = document.createElement('button');
        del.className = 'btn-icon btn-remove-action';
        del.textContent = '−';
        del.title = 'Remove parameter';
        del.style.color = '#c75f8a';
        del.addEventListener('click', () => { workflowParameters.splice(idx, 1); rebuild(); });

        row.appendChild(nameInp); row.appendChild(labelInp); row.appendChild(typeSel);
        row.appendChild(reqChk); row.appendChild(defInp); row.appendChild(del);
        body.appendChild(row);
      });

      const addBtn = document.createElement('button');
      addBtn.className = 'btn-add-action';
      addBtn.textContent = '+ Add Parameter';
      addBtn.addEventListener('click', () => {
        workflowParameters.push({ name: '', label: '', type: 'string', required: false, defaultValue: '' });
        rebuild();
      });
      body.appendChild(addBtn);

      const hint = document.createElement('div');
      hint.className = 'params-modal-hint';
      hint.textContent = 'Parameters let a workflow run with different inputs. ' +
        'A Call Workflow step can pass values by name; defaults apply when a value is omitted. ' +
        'Refer to parameters in steps as {{paramName}}.';
      body.appendChild(hint);
    };

    const footer = document.createElement('div');
    footer.className = 'params-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-toolbar';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      workflowParameters = backup;
      closeParamsModal();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-run';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      workflowParameters = workflowParameters.filter(p => p && p.name && p.name.trim());
      closeParamsModal();
      showNotification('Workflow parameters updated', 'success', 1500);
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    const backup = workflowParameters.map(p => ({ ...p }));
    rebuild();
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    paramsModal = overlay;
  }

  function closeParamsModal() {
    if (paramsModal) {
      paramsModal.remove();
      paramsModal = null;
    }
  }

  paramsBtn.addEventListener('click', openParamsModal);

  function modalEl(className, text) {
    const el = document.createElement('div');
    el.className = `params-modal-${className}`;
    el.textContent = text;
    return el;
  }

  function input(label, value, onChange) {
    const inp = document.createElement('input');
    inp.className = 'config-input';
    inp.type = 'text';
    inp.title = label;
    inp.value = value;
    inp.addEventListener('input', () => onChange(inp.value));
    return inp;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (paramsModal) closeParamsModal();
      else if (configPanelNodeId) closeConfigPanel();
    }
  });

  // ─── DAG FUNCTIONS ─────────────────────────────────────────────────────────
  // Visual DAG editor functions for node-based workflow canvas.

  /**
   * Initialize DAG canvas DOM references.
   * Called once on page load after DOM is ready.
   */
  function initDagCanvas() {
    dagCanvasEl = $('dagCanvas');
    dagTransformEl = $('dagTransform');
    dagNodesEl = $('dagNodes');
    dagEdgesEl = $('dagEdges');
    dagTempConnectionEl = $('dagTempConnection');
    dagMinimapEl = $('dagMinimap');
    dagMinimapContentEl = $('dagMinimapContent');
    dagMinimapViewportEl = $('dagMinimapViewport');
    dagZoomLevelEl = $('dagZoomLevel');

    // Set up zoom controls
    $('dagZoomIn').addEventListener('click', () => dagSetZoom(dagZoom * 1.2));
    $('dagZoomOut').addEventListener('click', () => dagSetZoom(dagZoom / 1.2));
    $('dagZoomFit').addEventListener('click', dagFitToView);

    // Set up canvas mouse events for pan
    dagCanvasEl.addEventListener('mousedown', dagOnCanvasMouseDown);
    dagCanvasEl.addEventListener('mousemove', dagOnCanvasMouseMove);
    dagCanvasEl.addEventListener('mouseup', dagOnCanvasMouseUp);
    dagCanvasEl.addEventListener('mouseleave', dagOnCanvasMouseUp);
    dagCanvasEl.addEventListener('wheel', dagOnCanvasWheel, { passive: false });

    // Set up drop zone for palette items
    dagCanvasEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dagCanvasEl.addEventListener('drop', dagOnCanvasDrop);

    // Palette toggle button
    btnTogglePalette.addEventListener('click', () => {
      palette.classList.toggle('collapsed');
    });

    // Config panel close button
    configPanelClose.addEventListener('click', closeConfigPanel);

    dagUpdateTransform();
    dagUpdateMinimap();
  }

  /**
   * Convert screen coordinates to DAG canvas coordinates.
   * @param {number} screenX 
   * @param {number} screenY 
   * @returns {{x: number, y: number}}
   */
  function dagScreenToCanvas(screenX, screenY) {
    const rect = dagCanvasEl.getBoundingClientRect();
    return {
      x: (screenX - rect.left - dagPanOffset.x) / dagZoom,
      y: (screenY - rect.top - dagPanOffset.y) / dagZoom
    };
  }

  /** Fast screen→canvas using a pre-cached rect (used during drag). */
  function dagScreenToCanvasFast(screenX, screenY) {
    const r = dagCachedCanvasRect;
    return {
      x: (screenX - r.left - dagPanOffset.x) / dagZoom,
      y: (screenY - r.top - dagPanOffset.y) / dagZoom
    };
  }

  /**
   * Convert DAG canvas coordinates to screen coordinates.
   * @param {number} canvasX 
   * @param {number} canvasY 
   * @returns {{x: number, y: number}}
   */
  function dagCanvasToScreen(canvasX, canvasY) {
    const rect = dagCanvasEl.getBoundingClientRect();
    return {
      x: canvasX * dagZoom + dagPanOffset.x + rect.left,
      y: canvasY * dagZoom + dagPanOffset.y + rect.top
    };
  }

  /**
   * Update the SVG transform attribute for pan/zoom.
   */
  function dagUpdateTransform() {
    if (!dagTransformEl) return;
    dagTransformEl.setAttribute('transform', 
      `translate(${dagPanOffset.x}, ${dagPanOffset.y}) scale(${dagZoom})`
    );
    if (dagZoomLevelEl) {
      dagZoomLevelEl.textContent = `${Math.round(dagZoom * 100)}%`;
    }
  }

  /**
   * Set zoom level and update transform.
   * @param {number} newZoom - New zoom level (0.1 to 3.0)
   */
  function dagSetZoom(newZoom) {
    dagZoom = Math.max(0.1, Math.min(3.0, newZoom));
    dagUpdateTransform();
    dagUpdateMinimap();
  }

  /**
   * Fit all nodes in view.
   */
  function dagFitToView() {
    if (dagNodes.size === 0) {
      dagPanOffset = { x: 0, y: 0 };
      dagZoom = 1;
      dagUpdateTransform();
      dagUpdateMinimap();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of dagNodes.values()) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + DAG_NODE_WIDTH);
      maxY = Math.max(maxY, node.position.y + DAG_NODE_HEIGHT);
    }

    const padding = 50;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    const rect = dagCanvasEl.getBoundingClientRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    dagZoom = Math.min(scaleX, scaleY, 1.5);

    dagPanOffset = {
      x: (rect.width - width * dagZoom) / 2 - minX * dagZoom + padding * dagZoom,
      y: (rect.height - height * dagZoom) / 2 - minY * dagZoom + padding * dagZoom
    };

    dagUpdateTransform();
    dagUpdateMinimap();
  }

  /**
   * Save current state to undo stack.
   */
  function dagSaveState() {
    const state = {
      nodes: Array.from(dagNodes.entries()).map(([id, node]) => ({ ...node, position: { ...node.position } })),
      edges: Array.from(dagEdges.entries()).map(([id, edge]) => ({ ...edge }))
    };
    dagUndoStack.push(state);
    if (dagUndoStack.length > DAG_MAX_UNDO) {
      dagUndoStack.shift();
    }
    dagRedoStack = [];
  }

  /**
   * Undo last action.
   */
  function dagUndo() {
    if (dagUndoStack.length === 0) return;
    const currentState = {
      nodes: Array.from(dagNodes.entries()).map(([id, node]) => ({ ...node, position: { ...node.position } })),
      edges: Array.from(dagEdges.entries()).map(([id, edge]) => ({ ...edge }))
    };
    dagRedoStack.push(currentState);

    const prevState = dagUndoStack.pop();
    dagNodes.clear();
    dagEdges.clear();
    for (const node of prevState.nodes) {
      dagNodes.set(node.id, node);
    }
    for (const edge of prevState.edges) {
      dagEdges.set(edge.id, edge);
    }
    dagSelectedNodes.clear();
    dagSelectedEdge = null;
    dagRenderAll();
  }

  /**
   * Redo last undone action.
   */
  function dagRedo() {
    if (dagRedoStack.length === 0) return;
    const currentState = {
      nodes: Array.from(dagNodes.entries()).map(([id, node]) => ({ ...node, position: { ...node.position } })),
      edges: Array.from(dagEdges.entries()).map(([id, edge]) => ({ ...edge }))
    };
    dagUndoStack.push(currentState);

    const nextState = dagRedoStack.pop();
    dagNodes.clear();
    dagEdges.clear();
    for (const node of nextState.nodes) {
      dagNodes.set(node.id, node);
    }
    for (const edge of nextState.edges) {
      dagEdges.set(edge.id, edge);
    }
    dagSelectedNodes.clear();
    dagSelectedEdge = null;
    dagRenderAll();
  }

  /**
   * Add a new node to the DAG canvas.
   * @param {string} type - Activity type
   * @param {number} x - X position
   * @param {number} y - Y position
   * @returns {string} Node ID
   */
  function dagAddNode(type, x, y) {
    const act = activities.find(a => a.type === type);
    if (!act) {
      showNotification(`Activity type "${type}" not found`, 'error');
      return null;
    }

    dagSaveState();
    const nodeId = `step_${stepCounter++}`;
    const node = {
      id: nodeId,
      type,
      displayName: act.displayName,
      notes: '',
      position: { x, y },
      config: defaultConfig(act),
      status: 'Pending',
      stats: {},
      error: null,
      preview: null
    };

    dagNodes.set(nodeId, node);
    // Also add to steps array for compatibility
    steps.push(node);
    
    dagRenderNode(node);
    dagUpdateMinimap();
    dagUpdateEmptyState();

    logLine(`Added: ${act.displayName}`, 'info');
    showNotification(`Added "${act.displayName}"`, 'success', 1500);

    return nodeId;
  }

  /**
   * Remove a node and its connected edges from the DAG canvas.
   * @param {string} nodeId 
   */
  function dagRemoveNode(nodeId) {
    dagSaveState();
    const node = dagNodes.get(nodeId);
    if (!node) return;

    const act = activities.find(a => a.type === node.type);
    if (act) {
      logLine(`Removed: ${act.displayName}`, 'info');
    }

    // Remove connected edges
    const edgesToRemove = [];
    for (const [edgeId, edge] of dagEdges) {
      if (edge.source.nodeId === nodeId || edge.target.nodeId === nodeId) {
        edgesToRemove.push(edgeId);
      }
    }
    for (const edgeId of edgesToRemove) {
      dagEdges.delete(edgeId);
    }

    dagNodes.delete(nodeId);
    steps = steps.filter(s => s.id !== nodeId);
    dagSelectedNodes.delete(nodeId);

    dagRenderAll();
    dagUpdateMinimap();
    dagUpdateEmptyState();
  }

  /**
   * Add an edge between two nodes.
   * @param {string} sourceNodeId 
   * @param {string} sourcePort 
   * @param {string} targetNodeId 
   * @param {string} targetPort 
   * @param {string} [label] 
   * @returns {string} Edge ID
   */
  function dagAddEdge(sourceNodeId, sourcePort, targetNodeId, targetPort, label) {
    // Validate: no self-loops
    if (sourceNodeId === targetNodeId) {
      showNotification('Cannot connect a node to itself', 'warning');
      return null;
    }

    // Validate: no duplicate edges
    for (const edge of dagEdges.values()) {
      if (edge.source.nodeId === sourceNodeId && edge.source.port === sourcePort &&
          edge.target.nodeId === targetNodeId && edge.target.port === targetPort) {
        showNotification('Connection already exists', 'warning');
        return null;
      }
    }

    dagSaveState();
    const edgeId = `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const edge = {
      id: edgeId,
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      label
    };

    dagEdges.set(edgeId, edge);
    dagRenderEdge(edge);
    dagUpdateMinimap();

    return edgeId;
  }

  /**
   * Remove an edge from the DAG canvas.
   * @param {string} edgeId 
   */
  function dagRemoveEdge(edgeId) {
    dagSaveState();
    dagEdges.delete(edgeId);
    dagSelectedEdge = null;
    dagRenderAll();
    dagUpdateMinimap();
  }

  /**
   * Get all edges connected to a node.
   * @param {string} nodeId 
   * @returns {Array}
   */
  function dagGetNodeEdges(nodeId) {
    const result = [];
    for (const edge of dagEdges.values()) {
      if (edge.source.nodeId === nodeId || edge.target.nodeId === nodeId) {
        result.push(edge);
      }
    }
    return result;
  }

  /**
   * Check if a port is connected.
   * @param {string} nodeId 
   * @param {string} port 
   * @returns {boolean}
   */
  function dagIsPortConnected(nodeId, port) {
    for (const edge of dagEdges.values()) {
      if ((edge.source.nodeId === nodeId && edge.source.port === port) ||
          (edge.target.nodeId === nodeId && edge.target.port === port)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Update the empty state visibility.
   */
  function dagUpdateEmptyState() {
    const isEmpty = dagNodes.size === 0;
    canvasEmpty.classList.toggle('visible', isEmpty);
  }

  // ─── DAG RENDERING ─────────────────────────────────────────────────────────

  /**
   * Render all DAG elements (nodes and edges).
   */
  function dagRenderAll() {
    if (!dagNodesEl || !dagEdgesEl) return;

    dagNodesEl.innerHTML = '';
    dagEdgesEl.innerHTML = '';

    for (const node of dagNodes.values()) {
      dagRenderNode(node);
    }

    for (const edge of dagEdges.values()) {
      dagRenderEdge(edge);
    }

    updateStatus();
  }

  /**
   * Render a single node.
   * @param {Object} node 
   */
  function dagRenderNode(node) {
    const act = activities.find(a => a.type === node.type);
    if (!act) return;

    const meta = catMeta(act.category);
    const isSelected = dagSelectedNodes.has(node.id);

    // Create node group
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `dag-node ${isSelected ? 'selected' : ''}`);
    g.setAttribute('data-node-id', node.id);
    g.setAttribute('transform', `translate(${node.position.x}, ${node.position.y})`);

    // Clipped content group — prevents text from overflowing the node box
    const clip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    clip.setAttribute('clip-path', 'url(#dagNodeClip)');

    // Node body
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('class', 'dag-node-body');
    body.setAttribute('width', DAG_NODE_WIDTH);
    body.setAttribute('height', DAG_NODE_HEIGHT);
    clip.appendChild(body);

    // Node header background
    const headerBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    headerBg.setAttribute('class', 'dag-node-header');
    headerBg.setAttribute('width', DAG_NODE_WIDTH);
    headerBg.setAttribute('height', 24);
    headerBg.setAttribute('rx', '6');
    headerBg.setAttribute('ry', '6');
    clip.appendChild(headerBg);

    // Category icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('class', 'dag-node-icon');
    icon.setAttribute('x', '12');
    icon.setAttribute('y', '16');
    icon.setAttribute('fill', meta.color);
    icon.textContent = meta.icon;
    clip.appendChild(icon);

    // Node title (uses custom displayName, falls back to activity name)
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('class', 'dag-node-title');
    title.setAttribute('x', '30');
    title.setAttribute('y', '16');
    title.textContent = node.displayName || act.displayName;
    clip.appendChild(title);

    // Node type label (show activity type, not the custom name)
    const typeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    typeLabel.setAttribute('class', 'dag-node-type');
    typeLabel.setAttribute('x', '12');
    typeLabel.setAttribute('y', '42');
    typeLabel.textContent = act.displayName;
    clip.appendChild(typeLabel);

    // Notes indicator (small icon if notes exist)
    if (node.notes) {
      const notesIcon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      notesIcon.setAttribute('x', String(DAG_NODE_WIDTH - 28));
      notesIcon.setAttribute('y', '16');
      notesIcon.setAttribute('font-size', '10');
      notesIcon.setAttribute('fill', 'var(--vscode-descriptionForeground, #9a9a9a)');
      notesIcon.textContent = '📝';
      notesIcon.title = node.notes;
      clip.appendChild(notesIcon);

      // Show first line of notes on the node
      const notesPreview = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      notesPreview.setAttribute('class', 'dag-node-type');
      notesPreview.setAttribute('x', '12');
      notesPreview.setAttribute('y', '58');
      notesPreview.setAttribute('fill', 'var(--vscode-descriptionForeground, #9a9a9a)');
      notesPreview.setAttribute('font-style', 'italic');
      const firstLine = node.notes.split('\n')[0].substring(0, 22);
      notesPreview.textContent = firstLine + (node.notes.length > 22 ? '…' : '');
      notesPreview.title = node.notes;
      clip.appendChild(notesPreview);
    }

    // Status indicator
    const statusCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    statusCircle.setAttribute('class', `dag-node-status ${node.status.toLowerCase()}`);
    statusCircle.setAttribute('cx', String(DAG_NODE_WIDTH - 12));
    statusCircle.setAttribute('cy', '12');
    statusCircle.setAttribute('r', '4');
    clip.appendChild(statusCircle);

    // Error indicator
    if (node.error) {
      const errorIcon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      errorIcon.setAttribute('class', 'dag-node-status failed');
      errorIcon.setAttribute('x', String(DAG_NODE_WIDTH - 28));
      errorIcon.setAttribute('y', '16');
      errorIcon.textContent = '⚠';
      clip.appendChild(errorIcon);
    }

    g.appendChild(clip);

    // Input port (left side)
    const inputPort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    inputPort.setAttribute('class', `dag-port dag-port-input ${dagIsPortConnected(node.id, 'input') ? 'connected' : ''}`);
    inputPort.setAttribute('cx', '0');
    inputPort.setAttribute('cy', String(DAG_NODE_HEIGHT / 2));
    inputPort.setAttribute('r', String(DAG_PORT_RADIUS));
    inputPort.setAttribute('data-node-id', node.id);
    inputPort.setAttribute('data-port', 'input');
    inputPort.setAttribute('data-port-type', 'input');
    g.appendChild(inputPort);

    // Output port(s) — ifElse gets two: "then" (top-right) and "else" (bottom-right)
    if (node.type === 'ifElse') {
      const thenPort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      thenPort.setAttribute('class', `dag-port dag-port-output ${dagIsPortConnected(node.id, 'then') ? 'connected' : ''}`);
      thenPort.setAttribute('cx', String(DAG_NODE_WIDTH));
      thenPort.setAttribute('cy', '25');
      thenPort.setAttribute('r', String(DAG_PORT_RADIUS));
      thenPort.setAttribute('data-node-id', node.id);
      thenPort.setAttribute('data-port', 'then');
      thenPort.setAttribute('data-port-type', 'output');
      g.appendChild(thenPort);

      const thenLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      thenLabel.setAttribute('class', 'dag-port-label');
      thenLabel.setAttribute('x', String(DAG_NODE_WIDTH + 12));
      thenLabel.setAttribute('y', '29');
      thenLabel.textContent = 'Yes';
      g.appendChild(thenLabel);

      const elsePort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      elsePort.setAttribute('class', `dag-port dag-port-output ${dagIsPortConnected(node.id, 'else') ? 'connected' : ''}`);
      elsePort.setAttribute('cx', String(DAG_NODE_WIDTH));
      elsePort.setAttribute('cy', String(DAG_NODE_HEIGHT - 25));
      elsePort.setAttribute('r', String(DAG_PORT_RADIUS));
      elsePort.setAttribute('data-node-id', node.id);
      elsePort.setAttribute('data-port', 'else');
      elsePort.setAttribute('data-port-type', 'output');
      g.appendChild(elsePort);

      const elseLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      elseLabel.setAttribute('class', 'dag-port-label');
      elseLabel.setAttribute('x', String(DAG_NODE_WIDTH + 12));
      elseLabel.setAttribute('y', String(DAG_NODE_HEIGHT - 21));
      elseLabel.textContent = 'No';
      g.appendChild(elseLabel);
    } else {
      const outputPort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      outputPort.setAttribute('class', `dag-port dag-port-output ${dagIsPortConnected(node.id, 'output') ? 'connected' : ''}`);
      outputPort.setAttribute('cx', String(DAG_NODE_WIDTH));
      outputPort.setAttribute('cy', String(DAG_NODE_HEIGHT / 2));
      outputPort.setAttribute('r', String(DAG_PORT_RADIUS));
      outputPort.setAttribute('data-node-id', node.id);
      outputPort.setAttribute('data-port', 'output');
      outputPort.setAttribute('data-port-type', 'output');
      g.appendChild(outputPort);
    }

    // Stats preview (if completed) — inside clipped group
    if (node.status === 'Completed' && Object.keys(node.stats || {}).length > 0) {
      const statsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      statsText.setAttribute('class', 'dag-node-type');
      statsText.setAttribute('x', '12');
      statsText.setAttribute('y', '58');
      const stats = Object.entries(node.stats).slice(0, 2).map(([k, v]) => {
        const lbl = k === 'durationMs' ? 'time' : k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
        const val = k === 'durationMs' ? `${v}ms` : String(v);
        return `${lbl}: ${val}`;
      }).join(' | ');
      statsText.textContent = stats;
      clip.appendChild(statsText);
    }

    // Error message (if failed) — inside clipped group
    if (node.error) {
      const errorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      errorText.setAttribute('class', 'dag-node-type');
      errorText.setAttribute('x', '12');
      errorText.setAttribute('y', '72');
      errorText.setAttribute('fill', '#c75f8a');
      errorText.textContent = node.error.substring(0, 25) + (node.error.length > 25 ? '…' : '');
      clip.appendChild(errorText);
    }

    // Data preview button (if completed with preview data)
    if (node.status === 'Completed' && node.preview) {
      const previewBtn = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      previewBtn.setAttribute('class', 'dag-preview-btn');
      previewBtn.setAttribute('x', String(DAG_NODE_WIDTH - 28));
      previewBtn.setAttribute('y', '72');
      previewBtn.setAttribute('font-size', '12');
      previewBtn.setAttribute('fill', 'var(--vscode-focusBorder, #007fd4)');
      previewBtn.setAttribute('cursor', 'pointer');
      previewBtn.textContent = '👁';
      previewBtn.title = 'Preview data';
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDataPreview(node);
      });
      clip.appendChild(previewBtn);
    }

    // Add event listeners
    g.addEventListener('mousedown', (e) => dagOnNodeMouseDown(e, node.id));
    g.addEventListener('dblclick', (e) => dagOnNodeDoubleClick(e, node.id));

    // Port event listeners
    inputPort.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      dagOnPortMouseDown(e, node.id, 'input');
    });
    if (node.type === 'ifElse') {
      g.querySelectorAll('.dag-port[data-port-type="output"]').forEach((p) => {
        p.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          dagOnPortMouseDown(e, node.id, p.getAttribute('data-port'));
        });
      });
    } else {
      const op = g.querySelector('.dag-port-output');
      if (op) {
        op.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          dagOnPortMouseDown(e, node.id, 'output');
        });
      }
    }

    dagNodesEl.appendChild(g);
  }

  /**
   * Render a single edge.
   * @param {Object} edge 
   */
  /** Compute the bezier path string for an edge (used by render + drag). */
  function dagComputeEdgePath(edge) {
    const src = dagNodes.get(edge.source.nodeId);
    const tgt = dagNodes.get(edge.target.nodeId);
    if (!src || !tgt) return '';
    const s = dagGetPortPosition(edge.source.nodeId, edge.source.port);
    const t = dagGetPortPosition(edge.target.nodeId, edge.target.port);
    const dx = Math.abs(t.x - s.x) * 0.5;
    return `M ${s.x} ${s.y} C ${s.x + dx} ${s.y}, ${t.x - dx} ${t.y}, ${t.x} ${t.y}`;
  }

  function dagRenderEdge(edge) {
    const sourceNode = dagNodes.get(edge.source.nodeId);
    const targetNode = dagNodes.get(edge.target.nodeId);
    if (!sourceNode || !targetNode) return;

    const d = dagComputeEdgePath(edge);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `dag-edge ${dagSelectedEdge === edge.id ? 'selected' : ''}`);
    path.setAttribute('d', d);
    path.setAttribute('data-edge-id', edge.id);
    path.setAttribute('marker-end', dagSelectedEdge === edge.id ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');

    path.addEventListener('click', (e) => {
      e.stopPropagation();
      dagSelectedEdge = edge.id;
      dagRenderAll();
    });

    dagEdgesEl.appendChild(path);

    // Auto-label ifElse branch edges if no explicit label set
    const edgeLabel = edge.label || (sourceNode.type === 'ifElse' && edge.source.port === 'then' ? 'Yes' : null)
      || (sourceNode.type === 'ifElse' && edge.source.port === 'else' ? 'No' : null);
    if (edgeLabel) {
      const s = dagGetPortPosition(edge.source.nodeId, edge.source.port);
      const t = dagGetPortPosition(edge.target.nodeId, edge.target.port);
      const midX = (s.x + t.x) / 2;
      const midY = (s.y + t.y) / 2 - 10;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(midX));
      label.setAttribute('y', String(midY));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', 'var(--vscode-descriptionForeground, #9a9a9a)');
      label.setAttribute('font-size', '10');
      label.textContent = edgeLabel;
      dagEdgesEl.appendChild(label);
    }
  }

  /**
   * Update minimap.
   */
  function dagUpdateMinimap() {
    if (!dagMinimapContentEl || !dagMinimapViewportEl || !dagCanvasEl) return;

    dagMinimapContentEl.innerHTML = '';

    if (dagNodes.size === 0) {
      dagMinimapViewportEl.setAttribute('style', 'display: none');
      return;
    }

    // Calculate bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of dagNodes.values()) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + DAG_NODE_WIDTH);
      maxY = Math.max(maxY, node.position.y + DAG_NODE_HEIGHT);
    }

    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const width = maxX - minX;
    const height = maxY - minY;

    const minimapRect = dagMinimapEl.getBoundingClientRect();
    const scaleX = minimapRect.width / width;
    const scaleY = minimapRect.height / height;
    const scale = Math.min(scaleX, scaleY);

    // Render nodes in minimap
    for (const node of dagNodes.values()) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String((node.position.x - minX) * scale));
      rect.setAttribute('y', String((node.position.y - minY) * scale));
      rect.setAttribute('width', String(DAG_NODE_WIDTH * scale));
      rect.setAttribute('height', String(DAG_NODE_HEIGHT * scale));
      rect.setAttribute('fill', 'var(--vscode-focusBorder, #007fd4)');
      rect.setAttribute('opacity', '0.6');
      rect.setAttribute('rx', '2');
      dagMinimapContentEl.appendChild(rect);
    }

    // Render viewport indicator
    const canvasRect = dagCanvasEl.getBoundingClientRect();
    const viewportX = (-dagPanOffset.x / dagZoom - minX) * scale;
    const viewportY = (-dagPanOffset.y / dagZoom - minY) * scale;
    const viewportW = (canvasRect.width / dagZoom) * scale;
    const viewportH = (canvasRect.height / dagZoom) * scale;

    dagMinimapViewportEl.setAttribute('x', String(viewportX));
    dagMinimapViewportEl.setAttribute('y', String(viewportY));
    dagMinimapViewportEl.setAttribute('width', String(viewportW));
    dagMinimapViewportEl.setAttribute('height', String(viewportH));
    dagMinimapViewportEl.setAttribute('style', '');
  }

  // ─── DAG EVENT HANDLERS ────────────────────────────────────────────────────

  /**
   * Handle mousedown on canvas (pan start).
   */
  function dagOnCanvasMouseDown(e) {
    // Only start pan on middle click or when clicking on empty canvas
    if (e.button === 1 || (e.button === 0 && e.target === dagCanvasEl || e.target.classList.contains('dag-grid'))) {
      dagPanning = true;
      dagPanStart = { x: e.clientX - dagPanOffset.x, y: e.clientY - dagPanOffset.y };
      dagCanvasEl.style.cursor = 'grabbing';
      e.preventDefault();
    }
  }

  /**
   * Handle mousemove on canvas (pan, node drag, connection drag, selection).
   * Connection and node drag use rAF / direct SVG mutation to stay at 60 fps.
   */
  function dagOnCanvasMouseMove(e) {
    if (dagPanning) {
      dagPanOffset.x = e.clientX - dagPanStart.x;
      dagPanOffset.y = e.clientY - dagPanStart.y;
      dagUpdateTransform();
      dagUpdateMinimap();
      return;
    }

    if (dagDraggingNode) {
      const pos = dagScreenToCanvasFast(e.clientX, e.clientY);
      const node = dagNodes.get(dagDraggingNode);
      if (node) {
        node.position.x = pos.x - dagDraggingOffset.x;
        node.position.y = pos.y - dagDraggingOffset.y;
        // Direct SVG mutation instead of full dagRenderAll()
        dagUpdateDraggedNodeEdges(dagDraggingNode);
      }
      return;
    }

    if (dagConnectingFrom) {
      // Batch connection-line updates via rAF to avoid layout thrash
      dagConnectPendingPos = { x: e.clientX, y: e.clientY };
      if (!dagConnectRafId) {
        dagConnectRafId = requestAnimationFrame(dagFlushConnectionDrag);
      }
    }

    if (dagSelectionBox) {
      dagSelectionBox.endX = e.clientX;
      dagSelectionBox.endY = e.clientY;
      dagRenderSelectionBox();
    }
  }

  /** rAF callback — updates the temp connection path once per frame. */
  function dagFlushConnectionDrag() {
    dagConnectRafId = 0;
    const pos = dagConnectPendingPos;
    if (!pos || !dagConnectingFrom) return;
    const canvasPos = dagScreenToCanvasFast(pos.x, pos.y);
    const isOutput = dagConnectingFrom.port !== 'input';
    const s = isOutput
      ? dagGetPortPosition(dagConnectingFrom.nodeId, dagConnectingFrom.port)
      : canvasPos;
    const t = isOutput
      ? canvasPos
      : dagGetPortPosition(dagConnectingFrom.nodeId, dagConnectingFrom.port);
    const dx = Math.abs(t.x - s.x) * 0.5;
    const d = isOutput
      ? `M ${s.x} ${s.y} C ${s.x + dx} ${s.y}, ${t.x - dx} ${t.y}, ${t.x} ${t.y}`
      : `M ${s.x} ${s.y} C ${s.x + dx} ${s.y}, ${t.x - dx} ${t.y}, ${t.x} ${t.y}`;
    dagTempConnectionEl.setAttribute('d', d);
    if (dagConnectingFrom) {
      dagConnectRafId = requestAnimationFrame(dagFlushConnectionDrag);
    }
  }

  /**
   * Lightweight per-frame update for a dragged node: repositions the node's
   * SVG group and rebuilds only its connected edges.  Avoids full dagRenderAll().
   */
  function dagUpdateDraggedNodeEdges(nodeId) {
    const node = dagNodes.get(nodeId);
    if (!node) return;
    // Move the SVG <g> directly
    const g = dagNodesEl.querySelector(`g[data-node-id="${CSS.escape(nodeId)}"]`);
    if (g) g.setAttribute('transform', `translate(${node.position.x}, ${node.position.y})`);
    // Rebuild connected edges in-place
    for (const [, edge] of dagEdges) {
      if (edge.source.nodeId === nodeId || edge.target.nodeId === nodeId) {
        const path = dagEdgesEl.querySelector(`path[data-edge-id="${CSS.escape(edge.id)}"]`);
        if (path) path.setAttribute('d', dagComputeEdgePath(edge));
      }
    }
    dagUpdateMinimap();
  }

  /**
   * Handle mouseup on canvas (end pan, drag, connect, or selection).
   */
  function dagOnCanvasMouseUp(e) {
    if (dagPanning) {
      dagPanning = false;
      dagCanvasEl.style.cursor = 'grab';
    }

    if (dagDraggingNode) {
      dagDraggingNode = null;
      dagCachedCanvasRect = null;
      dagSaveState();
    }

    if (dagConnectingFrom) {
      // Cancel any pending rAF frame
      if (dagConnectRafId) { cancelAnimationFrame(dagConnectRafId); dagConnectRafId = 0; }
      dagConnectPendingPos = null;
      dagCachedCanvasRect = null;
      // Check if we dropped on a port
      const target = e.target;
      if (target.classList && target.classList.contains('dag-port')) {
        const targetNodeId = target.getAttribute('data-node-id');
        const targetPort = target.getAttribute('data-port');
        const targetType = target.getAttribute('data-port-type');

        // Connect output to input (handles 'output', 'then', 'else' port types)
        const fromPort = dagConnectingFrom.port;
        const fromIsOutput = fromPort !== 'input';
        if (fromIsOutput && targetType === 'input') {
          dagAddEdge(dagConnectingFrom.nodeId, fromPort, targetNodeId, targetPort);
        } else if (!fromIsOutput && targetType === 'output') {
          dagAddEdge(targetNodeId, targetPort, dagConnectingFrom.nodeId, fromPort);
        }
      }
      dagConnectingFrom = null;
      dagTempConnectionEl.setAttribute('d', '');
      dagTempConnectionEl.style.display = 'none';
      dagRenderAll();
    }

    if (dagSelectionBox) {
      dagFinishSelection();
      dagSelectionBox = null;
      dagClearSelectionBox();
    }
  }

  /**
   * Handle wheel event for zoom.
   */
  function dagOnCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    dagSetZoom(dagZoom * delta);
  }

  /**
   * Handle mousedown on a node (start drag or select).
   */
  function dagOnNodeMouseDown(e, nodeId) {
    // Handle right-click (context menu)
    if (e.button === 2) {
      showNodeContextMenu(e, nodeId);
      return;
    }
    if (e.button !== 0) return; // Only left click

    const node = dagNodes.get(nodeId);
    if (!node) return;

    // Handle selection with shift key
    if (e.shiftKey) {
      if (dagSelectedNodes.has(nodeId)) {
        dagSelectedNodes.delete(nodeId);
      } else {
        dagSelectedNodes.add(nodeId);
      }
    } else if (!dagSelectedNodes.has(nodeId)) {
      dagSelectedNodes.clear();
      dagSelectedNodes.add(nodeId);
    }

    dagSelectedEdge = null;

    // Start dragging — cache rect for fast screen→canvas during drag
    dagCachedCanvasRect = dagCanvasEl.getBoundingClientRect();
    const pos = dagScreenToCanvasFast(e.clientX, e.clientY);
    dagDraggingNode = nodeId;
    dagDraggingOffset = {
      x: pos.x - node.position.x,
      y: pos.y - node.position.y
    };

    // Targeted selection update — do NOT rebuild all SVG elements,
    // which would destroy the DOM node before dblclick can fire.
    dagUpdateSelectionVisuals();
  }

  /**
   * Update selection CSS classes on existing SVG nodes/edges
   * without rebuilding the entire DOM. This preserves element
   * identity so dblclick events fire correctly.
   */
  function dagUpdateSelectionVisuals() {
    // Update node selection classes
    const nodeGroups = dagNodesEl.querySelectorAll('.dag-node');
    nodeGroups.forEach(g => {
      const nid = g.getAttribute('data-node-id');
      g.classList.toggle('selected', dagSelectedNodes.has(nid));
    });
    // Update edge selection classes
    const edgePaths = dagEdgesEl.querySelectorAll('.dag-edge');
    edgePaths.forEach(p => {
      const eid = p.getAttribute('data-edge-id');
      const isSel = dagSelectedEdge === eid;
      p.classList.toggle('selected', isSel);
      p.setAttribute('marker-end', isSel ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
    });
  }

  /**
   * Handle double-click on a node (open config editor).
   */
  function dagOnNodeDoubleClick(e, nodeId) {
    openConfigPanel(nodeId);
  }

  // ─── CONFIG PANEL ──────────────────────────────────────────────────────────

  /**
   * Open the config panel for a given node.
   * @param {string} nodeId 
   */
  function openConfigPanel(nodeId) {
    const node = dagNodes.get(nodeId);
    if (!node) return;

    const act = activities.find(a => a.type === node.type);
    if (!act) return;

    const meta = catMeta(act.category);
    configPanelNodeId = nodeId;

    // Update header
    configPanelIcon.textContent = meta.icon;
    configPanelTitle.textContent = node.displayName || act.displayName;

    // Remove hidden class
    configPanel.classList.remove('hidden');

    // Build config fields
    configPanelBody.innerHTML = '';

    // ── Display Name (editable) ──
    const nameField = document.createElement('div');
    nameField.className = 'config-field';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'config-label';
    nameLabel.textContent = 'Display Name';
    const nameInput = document.createElement('input');
    nameInput.className = 'config-input';
    nameInput.type = 'text';
    nameInput.value = node.displayName || act.displayName;
    nameInput.placeholder = act.displayName;
    nameInput.addEventListener('input', () => {
      node.displayName = nameInput.value || act.displayName;
      configPanelTitle.textContent = node.displayName;
      dagRenderAll();
    });
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    configPanelBody.appendChild(nameField);

    // ── Notes / Comments ──
    const notesField = document.createElement('div');
    notesField.className = 'config-field';
    const notesLabel = document.createElement('label');
    notesLabel.className = 'config-label';
    notesLabel.textContent = 'Notes';
    const notesArea = document.createElement('textarea');
    notesArea.className = 'config-input';
    notesArea.style.cssText = 'min-height: 60px; resize: vertical; font-size: 11px;';
    notesArea.value = node.notes || '';
    notesArea.placeholder = 'Add notes about this step…';
    notesArea.addEventListener('input', () => {
      node.notes = notesArea.value;
      dagRenderAll();
    });
    notesField.appendChild(notesLabel);
    notesField.appendChild(notesArea);
    configPanelBody.appendChild(notesField);

    // ── Separator ──
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top: 1px solid var(--vscode-panel-border); margin: 8px 0 12px;';
    configPanelBody.appendChild(sep);

    // ── Activity-specific config fields ──
    renderConfigFields(node, act, configPanelBody);

    // ── Actions footer ──
    const actions = document.createElement('div');
    actions.className = 'config-panel-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-secondary';
    deleteBtn.textContent = '🗑 Delete';
    deleteBtn.style.color = '#c75f8a';
    deleteBtn.addEventListener('click', () => {
      dagRemoveNode(nodeId);
      closeConfigPanel();
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-secondary';
    resetBtn.textContent = '↺ Reset';
    resetBtn.addEventListener('click', () => {
      node.config = defaultConfig(act);
      openConfigPanel(nodeId);
      dagRenderAll();
    });

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn-primary';
    applyBtn.textContent = '✓ Apply';
    applyBtn.addEventListener('click', () => {
      dagRenderAll();
      showNotification(`Configuration updated for "${act.displayName}"`, 'success', 1500);
    });

    actions.appendChild(deleteBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(applyBtn);
    configPanelBody.appendChild(actions);
  }

  /**
   * Close the config panel.
   */
  function closeConfigPanel() {
    configPanelNodeId = null;
    configPanel.classList.add('hidden');
    configPanelBody.innerHTML = `
      <div class="config-panel-empty">
        <div class="config-panel-empty-icon">🖱️</div>
        <div class="config-panel-empty-text">Double-click a node on the canvas to configure it.</div>
      </div>
    `;
  }

  /**
   * Show a data preview modal for a completed node's output dataset.
   * @param {Object} node - DAG node with preview data
   */
  function showDataPreview(node) {
    if (!node || !node.preview) return;
    const preview = node.preview;
    const columns = preview.columns || [];
    const rows = preview.rows || [];
    const rowCount = preview.rowCount || rows.length;

    const overlay = document.createElement('div');
    overlay.className = 'params-modal-overlay';
    overlay.style.zIndex = '2000';

    let tableHtml = '<table class="data-preview-table"><thead><tr>';
    for (const col of columns) {
      tableHtml += '<th>' + esc(String(col)) + '</th>';
    }
    tableHtml += '</tr></thead><tbody>';
    for (const row of rows) {
      tableHtml += '<tr>';
      for (const col of columns) {
        const val = row[col];
        const display = val === null || val === undefined ? '<span class="null-value">null</span>' : esc(String(val));
        tableHtml += '<td>' + display + '</td>';
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';

    if (rowCount > rows.length) {
      tableHtml += '<div class="data-preview-more">Showing ' + rows.length + ' of ' + rowCount + ' rows</div>';
    }

    const act = activities.find(a => a.type === node.type);
    const title = node.displayName || (act ? act.displayName : node.type);

    overlay.innerHTML =
      '<div class="params-modal" style="width:min(90vw,800px);max-height:80vh;display:flex;flex-direction:column;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--vscode-panel-border);">' +
          '<div style="font-weight:600;">Data Preview: ' + esc(title) + '</div>' +
          '<button type="button" class="btn-icon" data-action="close" style="font-size:14px;" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="data-preview-container" style="flex:1;overflow:auto;padding:0 16px;">' + tableHtml + '</div>' +
        '<div class="params-modal-footer">' +
          '<button type="button" class="btn-primary" data-action="close">Close</button>' +
        '</div>' +
      '</div>';

    overlay.querySelectorAll('[data-action="close"]').forEach(btn => {
      btn.addEventListener('click', () => overlay.remove());
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /**
   * Sync a single config field in the config panel when the value
   * changes externally (e.g. file picker result, dynamic options).
   * Finds the matching <input> or <select> and updates its value.
   * @param {string} stepId
   * @param {string} fieldName
   * @param {*} value
   */
  function dagSyncConfigPanelField(stepId, fieldName, value) {
    if (!configPanelNodeId || configPanelNodeId !== stepId) return;
    const fields = configPanelBody.querySelectorAll('.config-field');
    for (const fieldEl of fields) {
      const reqName = fieldEl.dataset.reqName;
      if (reqName !== fieldName) continue;
      const inp = fieldEl.querySelector('input, select, textarea');
      if (inp) {
        inp.value = value ?? '';
        // Fire an input event so any dependent logic picks up the change
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      break;
    }
  }

  /**
   * Handle mousedown on a port (start connection).
   */
  function dagOnPortMouseDown(e, nodeId, portType) {
    e.stopPropagation();
    const node = dagNodes.get(nodeId);
    if (!node) return;

    // Cache canvas rect once at drag start — avoids getBoundingClientRect per mousemove
    dagCachedCanvasRect = dagCanvasEl.getBoundingClientRect();
    dagConnectingFrom = {
      nodeId,
      port: portType,
      startX: node.position.x,
      startY: node.position.y
    };
    dagTempConnectionEl.style.display = '';
  }

  /**
   * Handle drop from palette to canvas.
   */
  function dagOnCanvasDrop(e) {
    e.preventDefault();
    canvasWrap.style.borderColor = '';
    const type = e.dataTransfer.getData('activity-type');
    if (type) {
      const pos = dagScreenToCanvas(e.clientX, e.clientY);
      dagAddNode(type, pos.x - DAG_NODE_WIDTH / 2, pos.y - DAG_NODE_HEIGHT / 2);
    }
  }

  /**
   * Render selection box during rubber-band selection.
   */
  function dagRenderSelectionBox() {
    // Remove existing selection box
    const existing = document.querySelector('.dag-selection-box');
    if (existing) existing.remove();

    if (!dagSelectionBox) return;

    const x = Math.min(dagSelectionBox.startX, dagSelectionBox.endX);
    const y = Math.min(dagSelectionBox.startY, dagSelectionBox.endY);
    const width = Math.abs(dagSelectionBox.endX - dagSelectionBox.startX);
    const height = Math.abs(dagSelectionBox.endY - dagSelectionBox.startY);

    if (width < 5 && height < 5) return;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'dag-selection-box');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    dagCanvasEl.appendChild(rect);
  }

  /**
   * Clear selection box.
   */
  function dagClearSelectionBox() {
    const existing = document.querySelector('.dag-selection-box');
    if (existing) existing.remove();
  }

  /**
   * Finish rubber-band selection.
   */
  function dagFinishSelection() {
    if (!dagSelectionBox) return;

    const selX1 = Math.min(dagSelectionBox.startX, dagSelectionBox.endX);
    const selY1 = Math.min(dagSelectionBox.startY, dagSelectionBox.endY);
    const selX2 = Math.max(dagSelectionBox.startX, dagSelectionBox.endX);
    const selY2 = Math.max(dagSelectionBox.startY, dagSelectionBox.endY);

    // Convert selection bounds to canvas coordinates
    const canvas1 = dagScreenToCanvas(selX1, selY1);
    const canvas2 = dagScreenToCanvas(selX2, selY2);

    dagSelectedNodes.clear();

    for (const node of dagNodes.values()) {
      const nodeX1 = node.position.x;
      const nodeY1 = node.position.y;
      const nodeX2 = nodeX1 + DAG_NODE_WIDTH;
      const nodeY2 = nodeY1 + DAG_NODE_HEIGHT;

      // Check if node intersects selection box
      if (nodeX1 < canvas2.x && nodeX2 > canvas1.x &&
          nodeY1 < canvas2.y && nodeY2 > canvas1.y) {
        dagSelectedNodes.add(node.id);
      }
    }

    dagRenderAll();
  }

  /**
   * Auto-layout nodes in a hierarchical DAG structure.
   */
  function dagAutoLayout() {
    if (dagNodes.size === 0) return;

    dagSaveState();

    // Find root nodes (no incoming edges)
    const nodesWithIncoming = new Set();
    for (const edge of dagEdges.values()) {
      nodesWithIncoming.add(edge.target.nodeId);
    }

    const roots = [];
    for (const node of dagNodes.values()) {
      if (!nodesWithIncoming.has(node.id)) {
        roots.push(node);
      }
    }

    // If no roots found, use all nodes
    if (roots.length === 0) {
      roots.push(...dagNodes.values());
    }

    // BFS to assign layers
    const layers = new Map();
    const queue = [...roots];
    for (const root of roots) {
      layers.set(root.id, 0);
    }

    while (queue.length > 0) {
      const node = queue.shift();
      const currentLayer = layers.get(node.id);

      // Find all outgoing edges
      for (const edge of dagEdges.values()) {
        if (edge.source.nodeId === node.id) {
          const targetLayer = layers.get(edge.target.nodeId);
          if (targetLayer === undefined || targetLayer <= currentLayer) {
            layers.set(edge.target.nodeId, currentLayer + 1);
            queue.push(dagNodes.get(edge.target.nodeId));
          }
        }
      }
    }

    // Group nodes by layer
    const layerGroups = new Map();
    for (const [nodeId, layer] of layers) {
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, []);
      }
      layerGroups.get(layer).push(nodeId);
    }

    // Position nodes (left-to-right: layers along X, nodes stacked vertically)
    const layerSpacing = 300;
    const nodeSpacing = 30;

    for (const [layer, nodeIds] of layerGroups) {
      const totalHeight = nodeIds.length * DAG_NODE_HEIGHT + (nodeIds.length - 1) * nodeSpacing;
      let startY = -totalHeight / 2;

      for (const nodeId of nodeIds) {
        const node = dagNodes.get(nodeId);
        if (node) {
          node.position.x = layer * layerSpacing;
          node.position.y = startY;
          startY += DAG_NODE_HEIGHT + nodeSpacing;
        }
      }
    }

    dagRenderAll();
    dagFitToView();
    showNotification('Auto-layout applied', 'success');
  }

  /**
   * Clear all nodes and edges.
   */
  function dagClearAll() {
    if (dagNodes.size === 0) return;
    webviewConfirm('Remove all activities from the workflow?', () => {
      dagSaveState();
      dagNodes.clear();
      dagEdges.clear();
      dagSelectedNodes.clear();
      dagSelectedEdge = null;
      steps = [];
      stepCounter = 1;
      dagRenderAll();
      dagUpdateMinimap();
      dagUpdateEmptyState();
      logLine('Cleared all steps', 'info');
    }, 'Remove');
  }

  /**
   * Delete selected nodes/edges.
   */
  function dagDeleteSelected() {
    if (dagSelectedEdge) {
      dagRemoveEdge(dagSelectedEdge);
      return;
    }

    if (dagSelectedNodes.size > 0) {
      for (const nodeId of dagSelectedNodes) {
        dagRemoveNode(nodeId);
      }
      dagSelectedNodes.clear();
      dagRenderAll();
    }
  }

  /**
   * Select all nodes.
   */
  function dagSelectAll() {
    dagSelectedNodes.clear();
    for (const node of dagNodes.keys()) {
      dagSelectedNodes.add(node);
    }
    dagRenderAll();
  }

  // ─── INIT ──────────────────────────────────────────────────────────────────

  // Initialize DAG canvas
  initDagCanvas();

  // Add keyboard shortcuts for DAG editor
  document.addEventListener('keydown', (e) => {
    // Delete selected nodes/edges
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return; // Don't delete when typing in input fields
      }
      dagDeleteSelected();
      e.preventDefault();
    }

    // Select all (Ctrl+A)
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return; // Don't select all when typing in input fields
      }
      dagSelectAll();
      e.preventDefault();
    }

    // Undo (Ctrl+Z)
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      dagUndo();
      e.preventDefault();
    }

    // Redo (Ctrl+Shift+Z or Ctrl+Y)
    if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
        (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      dagRedo();
      e.preventDefault();
    }

    // Fit to view (F)
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      dagFitToView();
      e.preventDefault();
    }

    // Auto layout (L)
    if (e.key === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      dagAutoLayout();
      e.preventDefault();
    }
  });

  vscode.postMessage({ type: 'ready' });
  logLine('🚀 VizFlow Workflow Builder ready', 'info');
  updateStatus();

})();