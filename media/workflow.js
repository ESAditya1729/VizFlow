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

  // ─── DOM REFS ────────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  const paletteList = $('paletteList');
  const paletteSearch = $('paletteSearch');
  const paletteCategories = $('paletteCategories');
  const searchClear = $('searchClear');
  const activityList = $('activityList');
  const canvasEmpty = $('canvasEmpty');
  const canvasWrap = $('canvasWrap');
  const canvasContextMenu = $('canvasContextMenu');
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

  const vscode = acquireVsCodeApi();

  // ─── CATEGORY METADATA ──────────────────────────────────────────────────────

  const CAT = {
    'Input':          { color: '#2da680', bg: 'rgba(45,166,128,0.15)', icon: '📥', order: 0 },
    'Transformation': { color: '#7c6fde', bg: 'rgba(124,111,222,0.15)', icon: '⚙️', order: 1 },
    'Query':          { color: '#c97c2a', bg: 'rgba(201,124,42,0.15)',  icon: '🔍', order: 2 },
    'Analytics':      { color: '#c75f8a', bg: 'rgba(199,95,138,0.15)', icon: '📊', order: 3 },
    'Control':        { color: '#e07b39', bg: 'rgba(224,123,57,0.15)',  icon: '🔀', order: 4 },
    'Output':         { color: '#3a8fd4', bg: 'rgba(58,143,212,0.15)', icon: '📤', order: 5 },
  };

  const CAT_ORDER = ['Input', 'Transformation', 'Query', 'Analytics', 'Control', 'Output'];

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
      if (req.type === 'select' && req.options?.length) {
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
      } else {
        cfg[req.name] = req.defaultValue !== undefined ? req.defaultValue : '';
      }
    }
    // Block-specific sub-step arrays
    if (act.type === 'ifElse') {
      cfg.thenSteps = Array.isArray(cfg.thenSteps) ? cfg.thenSteps : [];
      cfg.elseSteps = Array.isArray(cfg.elseSteps) ? cfg.elseSteps : [];
    }
    if (act.type === 'forEach') {
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
    } else if (s && s.type === 'forEach') {
      cfg.steps = Array.isArray(s.config?.steps) ? s.config.steps.map(serializeStep) : [];
    }
    return { id: s.id, type: s.type, config: cfg };
  }

  function buildWorkflowDef() {
    return {
      name: workflowName.value.trim() || DEFAULT_WORKFLOW_NAME,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      activities: steps.map(serializeStep)
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
      } else if (a.type === 'forEach') {
        cfg.steps = normalizeSteps(Array.isArray(a.config?.steps) ? a.config.steps : []);
      }
      return { 
        id: a.id, 
        type: a.type, 
        config: cfg, 
        collapsed: false, 
        status: 'Pending', 
        stats: {}, 
        error: null 
      };
    }).filter(Boolean);
  }

  function loadWorkflowDef(def) {
    workflowName.value = def.name || DEFAULT_WORKFLOW_NAME;
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
        if (s.type === 'forEach') scanIds(s.config.steps || []);
      }
    }
    scanIds(steps);
    stepCounter = max + 1;
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
    
    steps.push({
      id: `step_${stepCounter++}`,
      type,
      config: defaultConfig(act),
      collapsed: false,
      status: 'Pending',
      stats: {},
      error: null
    });
    renderCanvas();
    logLine(`Added: ${act.displayName}`, 'info');
    showNotification(`Added "${act.displayName}"`, 'success', 1500);
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
    if (!confirm('Remove all activities from the workflow?')) return;
    steps = [];
    stepCounter = 1;
    renderCanvas();
    logLine('Cleared all steps', 'info');
  }

  // ─── CONFIG FIELD RENDERER ──────────────────────────────────────────────────

  function renderConfigFields(step, act, parentEl) {
    const configReqs = act.configRequirements || [];

    // Store reference to params field for dynamic updates
    let paramsField = null;
    let paramsInput = null;
    let paramsHint = null;

    for (const req of configReqs) {
      const field = document.createElement('div');
      field.className = 'config-field';

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
        });
        field.appendChild(sel);

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
          vscode.postMessage({ type: 'pickFile', stepId: step.id, field: req.name });
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

  // ─── SUB-CANVAS RENDERER ────────────────────────────────────────────────────

  function renderSubCanvas(subSteps, container, branchLabel, borderColor, onMutate) {
    const safeSubSteps = Array.isArray(subSteps) ? subSteps : [];
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = `block-branch-header ${branchLabel.toLowerCase()}`;
    header.style.borderLeftColor = borderColor;
    header.textContent = branchLabel;
    container.appendChild(header);

    const stepsWrap = document.createElement('div');
    stepsWrap.className = 'block-branch-steps';

    function rebuildSub() {
      stepsWrap.innerHTML = '';
      for (let i = 0; i < safeSubSteps.length; i++) {
        const subStep = safeSubSteps[i];
        const subAct = activities.find(a => a.type === subStep.type);
        if (!subAct) continue;

        if (i > 0) stepsWrap.appendChild(createSubConnector());

        const card = document.createElement('div');
        card.className = `activity-card sub-card status-${subStep.status}` + (subStep.collapsed ? ' collapsed' : '');

        const subMeta = catMeta(subAct.category);
        const hdr = document.createElement('div');
        hdr.className = 'activity-card-header';

        const num = document.createElement('div');
        num.className = 'step-num';
        num.style.background = subMeta.color;
        num.textContent = String(i + 1);

        const badge = document.createElement('div');
        badge.className = 'activity-icon-badge';
        badge.style.background = subMeta.bg;
        badge.textContent = subMeta.icon;

        const txt = document.createElement('div');
        txt.className = 'card-text';
        txt.innerHTML = `<div class="activity-card-title">${esc(subAct.displayName)}</div><div class="activity-card-meta">${esc(subStep.id)}</div>`;

        const statusBadge = document.createElement('span');
        statusBadge.className = `activity-status-badge status-badge-${subStep.status}`;
        statusBadge.textContent = subStep.status;

        const btns = document.createElement('div');
        btns.className = 'card-actions';
        btns.addEventListener('click', e => e.stopPropagation());

        if (i > 0) {
          const up = document.createElement('button');
          up.className = 'btn-icon'; up.title = 'Move up'; up.textContent = '↑';
          up.addEventListener('click', () => {
            [safeSubSteps[i - 1], safeSubSteps[i]] = [safeSubSteps[i], safeSubSteps[i - 1]];
            rebuildSub();
            onMutate?.();
          });
          btns.appendChild(up);
        }
        if (i < safeSubSteps.length - 1) {
          const dn = document.createElement('button');
          dn.className = 'btn-icon'; dn.title = 'Move down'; dn.textContent = '↓';
          dn.addEventListener('click', () => {
            [safeSubSteps[i], safeSubSteps[i + 1]] = [safeSubSteps[i + 1], safeSubSteps[i]];
            rebuildSub();
            onMutate?.();
          });
          btns.appendChild(dn);
        }
        const del = document.createElement('button');
        del.className = 'btn-icon'; del.title = 'Remove'; del.innerHTML = '&times;'; del.style.color = '#c75f8a';
        del.addEventListener('click', () => {
          safeSubSteps.splice(i, 1);
          rebuildSub();
          onMutate?.();
        });
        btns.appendChild(del);

        const chev = document.createElement('span');
        chev.className = 'collapse-chevron'; chev.textContent = '▾';

        hdr.appendChild(num); hdr.appendChild(badge); hdr.appendChild(txt);
        hdr.appendChild(statusBadge); hdr.appendChild(btns); hdr.appendChild(chev);
        hdr.addEventListener('click', () => { 
          subStep.collapsed = !subStep.collapsed; 
          card.classList.toggle('collapsed', subStep.collapsed); 
        });
        card.appendChild(hdr);

        const body = document.createElement('div');
        body.className = 'activity-body';
        renderConfigFields(subStep, subAct, body);
        
        if (subStep.status === 'Completed' && Object.keys(subStep.stats || {}).length > 0) {
          const sr = document.createElement('div'); sr.className = 'stats-row';
          for (const [k, v] of Object.entries(subStep.stats)) {
            const lbl = k === 'durationMs' ? 'time' : k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
            const val = k === 'durationMs' ? `${v}ms` : String(v);
            const pill = document.createElement('div'); pill.className = 'stat-pill';
            pill.innerHTML = `<span class="stat-label">${esc(lbl)}</span><span class="stat-value">${esc(val)}</span>`;
            sr.appendChild(pill);
          }
          body.appendChild(sr);
        }
        if (subStep.error) {
          const errEl = document.createElement('div'); errEl.className = 'error-banner';
          errEl.innerHTML = `<span class="error-banner-icon">⚠</span><span>${esc(subStep.error)}</span>`;
          body.appendChild(errEl);
        }
        card.appendChild(body);
        stepsWrap.appendChild(card);
      }

      // "Add step to branch" dropdown
      const addRow = document.createElement('div');
      addRow.className = 'block-add-step-row';
      const sel = document.createElement('select');
      sel.className = 'config-select block-add-select';
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = '+ Add step to branch…';
      sel.appendChild(placeholder);
      for (const a of activities) {
        const o = document.createElement('option');
        o.value = a.type; o.textContent = a.displayName;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        const type = sel.value;
        if (!type) return;
        const subAct2 = activities.find(a => a.type === type);
        if (!subAct2) return;
        safeSubSteps.push({
          id: `step_${stepCounter++}`,
          type,
          config: defaultConfig(subAct2),
          collapsed: false,
          status: 'Pending',
          stats: {},
          error: null
        });
        sel.value = '';
        rebuildSub();
        onMutate?.();
      });
      addRow.appendChild(sel);
      stepsWrap.appendChild(addRow);
    }

    rebuildSub();
    container.appendChild(stepsWrap);
  }

  // ─── CANVAS ──────────────────────────────────────────────────────────────────

  function renderCanvas() {
    const empty = steps.length === 0;
    canvasEmpty.classList.toggle('visible', empty);
    activityList.innerHTML = '';

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const act = activities.find(a => a.type === step.type);
      if (!act) continue;
      const meta = catMeta(act.category);

      if (i > 0) activityList.appendChild(createConnector());

      const card = document.createElement('div');
      const isBlock = step.type === 'ifElse' || step.type === 'forEach';
      card.className = `activity-card${isBlock ? ' block-card' : ''} status-${step.status}` + (step.collapsed ? ' collapsed' : '');
      card.dataset.stepId = step.id;

      // ── Header ──
      const header = document.createElement('div');
      header.className = 'activity-card-header';

      const stepNum = document.createElement('div');
      stepNum.className = 'step-num';
      stepNum.style.background = meta.color;
      stepNum.textContent = String(i + 1);

      const iconBadge = document.createElement('div');
      iconBadge.className = 'activity-icon-badge';
      iconBadge.style.background = meta.bg;
      iconBadge.textContent = meta.icon;

      const cardText = document.createElement('div');
      cardText.className = 'card-text';
      cardText.innerHTML = `
        <div class="activity-card-title">${esc(act.displayName)}</div>
        <div class="activity-card-meta">${esc(step.id)}</div>
      `;

      const statusBadge = document.createElement('span');
      statusBadge.className = `activity-status-badge status-badge-${step.status}`;
      statusBadge.textContent = step.status;

      const cardActions = document.createElement('div');
      cardActions.className = 'card-actions';
      cardActions.addEventListener('click', e => e.stopPropagation());

      if (i > 0) {
        const up = document.createElement('button');
        up.className = 'btn-icon'; up.title = 'Move up'; up.textContent = '↑';
        up.addEventListener('click', () => moveStep(step.id, -1));
        cardActions.appendChild(up);
      }
      if (i < steps.length - 1) {
        const dn = document.createElement('button');
        dn.className = 'btn-icon'; dn.title = 'Move down'; dn.textContent = '↓';
        dn.addEventListener('click', () => moveStep(step.id, 1));
        cardActions.appendChild(dn);
      }
      const del = document.createElement('button');
      del.className = 'btn-icon'; del.title = 'Remove step'; del.innerHTML = '&times;'; del.style.color = '#c75f8a';
      del.addEventListener('click', () => removeStep(step.id));
      cardActions.appendChild(del);

      const chevron = document.createElement('span');
      chevron.className = 'collapse-chevron';
      chevron.textContent = '▾';

      header.appendChild(stepNum); header.appendChild(iconBadge); header.appendChild(cardText);
      header.appendChild(statusBadge); header.appendChild(cardActions); header.appendChild(chevron);
      header.addEventListener('click', () => {
        step.collapsed = !step.collapsed;
        card.classList.toggle('collapsed', step.collapsed);
      });
      card.appendChild(header);

      // ── Body ──
      const body = document.createElement('div');
      body.className = 'activity-body';

      // Flat config fields (shared by all types)
      renderConfigFields(step, act, body);

      // ── Block-specific branch sub-canvases ──
      if (step.type === 'ifElse') {
        if (!Array.isArray(step.config.thenSteps)) step.config.thenSteps = [];
        if (!Array.isArray(step.config.elseSteps)) step.config.elseSteps = [];

        const thenContainer = document.createElement('div');
        thenContainer.className = 'block-branch';
        const elseContainer = document.createElement('div');
        elseContainer.className = 'block-branch';

        const repaint = () => {
          renderSubCanvas(step.config.thenSteps, thenContainer, '✅ THEN (matching rows)', '#2da680', repaint);
          renderSubCanvas(step.config.elseSteps, elseContainer, '❌ ELSE (non-matching rows)', '#c75f8a', repaint);
        };
        renderSubCanvas(step.config.thenSteps, thenContainer, '✅ THEN (matching rows)', '#2da680', repaint);
        renderSubCanvas(step.config.elseSteps, elseContainer, '❌ ELSE (non-matching rows)', '#c75f8a', repaint);

        const branchWrap = document.createElement('div');
        branchWrap.className = 'block-branches';
        branchWrap.appendChild(thenContainer);
        branchWrap.appendChild(elseContainer);
        body.appendChild(branchWrap);

      } else if (step.type === 'forEach') {
        if (!Array.isArray(step.config.steps)) step.config.steps = [];

        const doContainer = document.createElement('div');
        doContainer.className = 'block-branch';
        renderSubCanvas(step.config.steps, doContainer, '🔁 DO (per group)', '#e07b39', null);

        const branchWrap = document.createElement('div');
        branchWrap.className = 'block-branches';
        branchWrap.appendChild(doContainer);
        body.appendChild(branchWrap);
      }

      // Stats + error
      if (step.status === 'Completed' && Object.keys(step.stats || {}).length > 0) {
        const sr = document.createElement('div');
        sr.className = 'stats-row';
        for (const [k, v] of Object.entries(step.stats)) {
          const lbl = k === 'durationMs' ? 'time' : k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
          const val = k === 'durationMs' ? `${v}ms` : String(v);
          const pill = document.createElement('div');
          pill.className = 'stat-pill';
          pill.innerHTML = `<span class="stat-label">${esc(lbl)}</span><span class="stat-value">${esc(val)}</span>`;
          sr.appendChild(pill);
        }
        body.appendChild(sr);
      }
      if (step.error) {
        const errEl = document.createElement('div');
        errEl.className = 'error-banner';
        errEl.innerHTML = `<span class="error-banner-icon">⚠</span><span>${esc(step.error)}</span>`;
        body.appendChild(errEl);
      }

      card.appendChild(body);
      activityList.appendChild(card);
    }
    
    updateStatus();
  }

  function createConnector() {
    const wrap = document.createElement('div');
    wrap.className = 'step-connector';
    wrap.innerHTML = `
      <svg width="20" height="32" viewBox="0 0 20 32">
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="8"
                  refX="4" refY="4" orient="auto">
            <path d="M1,1 L7,4 L1,7 Z" fill="var(--connector-arrow, #454545)" />
          </marker>
        </defs>
        <line x1="10" y1="0" x2="10" y2="26"
              class="connector-line"
              stroke="var(--vscode-panel-border, #454545)"
              stroke-width="2"
              marker-end="url(#arr)" />
      </svg>`;
    return wrap;
  }

  function createSubConnector() {
    const wrap = document.createElement('div');
    wrap.className = 'step-connector sub-connector';
    wrap.innerHTML = `
      <svg width="14" height="20" viewBox="0 0 14 20">
        <defs>
          <marker id="arr-sub" markerWidth="6" markerHeight="6"
                  refX="3" refY="3" orient="auto">
            <path d="M1,1 L5,3 L1,5 Z" fill="var(--connector-arrow, #454545)" />
          </marker>
        </defs>
        <line x1="7" y1="0" x2="7" y2="16"
              class="connector-line"
              stroke="var(--vscode-panel-border, #454545)"
              stroke-width="1.5"
              marker-end="url(#arr-sub)" />
      </svg>`;
    return wrap;
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

  canvasWrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasWrap.style.borderColor = 'var(--vscode-focusBorder, #007fd4)';
  });

  canvasWrap.addEventListener('dragleave', (e) => {
    canvasWrap.style.borderColor = '';
  });

  canvasWrap.addEventListener('drop', (e) => {
    e.preventDefault();
    canvasWrap.style.borderColor = '';
    const type = e.dataTransfer.getData('activity-type');
    if (type) addStep(type);
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
    if (steps.length > 0 && !confirm('Discard current workflow and start new?')) return;
    steps = [];
    stepCounter = 1;
    currentFile = null;
    workflowName.value = DEFAULT_WORKFLOW_NAME;
    updateFileInfo();
    renderCanvas();
    logLine('New workflow created.', 'info');
    showNotification('New workflow created', 'success', 1500);
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
        // Search top-level steps AND nested block steps
        function findStep(list, id) {
          for (const s of list) {
            if (s.id === id) return s;
            if (s.type === 'ifElse') {
              const found = findStep(s.config.thenSteps || [], id) || findStep(s.config.elseSteps || [], id);
              if (found) return found;
            } else if (s.type === 'forEach') {
              const found = findStep(s.config.steps || [], id);
              if (found) return found;
            }
          }
          return null;
        }
        const step = findStep(steps, msg.activityId);
        if (!step) break;
        step.status = msg.state;
        step.stats = msg.stats || step.stats;
        step.error = msg.error || null;
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
        const step = steps.find(s => s.id === msg.stepId);
        if (step && msg.filePath) {
          step.config[msg.field] = msg.filePath;
          renderCanvas();
        }
        break;
      }

      case 'error':
        setRunning(false);
        logLine(`Error: ${msg.message}`, 'error');
        showNotification(`Error: ${msg.message}`, 'error', 4000);
        break;

      default:
        console.warn('Unknown message type:', msg.type);
    }
  });

  // ─── INIT ──────────────────────────────────────────────────────────────────

  vscode.postMessage({ type: 'ready' });
  logLine('🚀 VizFlow Workflow Builder ready', 'info');
  updateStatus();

})();