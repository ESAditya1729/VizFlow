export interface Feature {
  id: string;
  glyph: string;
  title: string;
  tagline: string;
  summary: string;
  bullets: string[];
  shot: string;
}

export const FEATURES: Feature[] = [
  {
    id: 'compare',
    glyph: '⇄',
    title: 'CSV Compare',
    tagline: 'Know exactly what changed between two files.',
    summary:
      'Compare two CSVs by distinct values or row by row using one or more key columns, then export a report you can trust.',
    bullets: [
      'Values mode and keyed-rows mode (added / removed / changed / unchanged)',
      'Composite keys across multiple columns',
      'Normalization: trim, ignore case, empty-as-null, numeric and date equality',
      'Encoding (UTF-8, UTF-16, Latin-1, auto BOM) and delimiter controls',
      'Safe CSV, JSON and Markdown exports with metadata',
    ],
    shot: 'CSV Compare — keyed rows view',
  },
  {
    id: 'rbql',
    glyph: '⌕',
    title: 'RBQL Query Console',
    tagline: 'SQL-like queries over plain CSV files.',
    summary:
      'Run SELECT queries (with joins) against any CSV without importing it anywhere. History is saved, long runs can be cancelled.',
    bullets: [
      'Query history with timestamp, source file, duration and row count',
      'Join a second file, with its own header setting',
      'Run IDs and a Cancel button so stale results never overwrite new ones',
      'Export to CSV, JSON, Markdown or clipboard',
      'UPDATE is clearly a preview — your source file is never modified',
    ],
    shot: 'RBQL Query Console — results grid',
  },
  {
    id: 'dashboard',
    glyph: '▦',
    title: 'Dashboard',
    tagline: 'Profile a dataset in one click.',
    summary:
      'Get column statistics and data-quality signals up front, with quick actions for duplicates and distinct values.',
    bullets: [
      'Column profiling and data-quality overview',
      'Quick actions: find duplicate values, show distinct values',
      'Starting point for the other tools',
    ],
    shot: 'Dashboard — data profile',
  },
  {
    id: 'workflow-builder',
    glyph: '⛓',
    title: 'Visual Workflow Builder',
    tagline: 'Chain data steps into repeatable workflows.',
    summary:
      'Design workflows visually and save them as readable .vizflow JSON that you can version-control and share.',
    bullets: [
      '45 built-in activity types',
      'Variables, control flow and sub-workflows',
      'Plain-text .vizflow files that diff cleanly in Git',
    ],
    shot: 'Workflow Builder — canvas',
  },
  {
    id: 'charts-transforms',
    glyph: '◔',
    title: 'Charts & Transformations',
    tagline: 'Reshape the data, then see it.',
    summary:
      'Build a transformation queue visually and plot your data with interactive charts, without leaving the editor.',
    bullets: [
      'Visual Transformation Studio with an ordered step queue',
      'Interactive charts for quick exploration',
      'No scripts to write for common clean-up tasks',
    ],
    shot: 'Transformation Studio and charts',
  },
  {
    id: 'scheduler-sources',
    glyph: '⏱',
    title: 'Scheduler & Data Sources',
    tagline: 'Automate it and connect it.',
    summary:
      'Run workflows on a schedule and pull data from external sources into the same tools.',
    bullets: [
      'Workflow Scheduler for recurring runs',
      'External Data Sources for databases and more',
      'Local-first: your data stays on your machine',
    ],
    shot: 'Scheduler and Data Sources',
  },
];

export const HIGHLIGHTS = [
  { title: 'Local & private', text: 'Files are processed on your machine. No telemetry, no uploads.' },
  { title: 'Built for VS Code', text: 'Lives in the editor you already use — no context switching.' },
  { title: 'Repeatable', text: 'Turn one-off analysis into workflows you can re-run and share.' },
];

export const WHATS_NEW = [
  {
    tag: 'New',
    title: 'Keyed row comparison',
    text: 'Compare CSVs row by row with composite keys and normalization, not just distinct values.',
  },
  {
    tag: 'Improved',
    title: 'Trustworthy RBQL exports',
    text: 'CSV export now quotes commas, quotes and newlines correctly; JSON and Markdown added.',
  },
  {
    tag: 'New',
    title: 'Run IDs and Cancel',
    text: 'Cancel long RBQL runs and never see late results overwrite newer ones.',
  },
];
