import { useState, useRef, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { ToolType } from '../types/game';
import './Toolbar.css';

// ── Public sub-tools ──────────────────────────────────────────────────────────

interface SubToolDef {
  type:        ToolType;
  label:       string;
  color:       string;
  description: string;
  cost:        number;
}

const PUBLIC_SUBS: SubToolDef[] = [
  { type: 'public_education',  label: 'Education',  color: '#E8904A', description: 'Schools & libraries · boosts education score', cost: 100 },
  { type: 'public_security',   label: 'Security',   color: '#1E5080', description: 'Police & fire stations · raises city health',   cost: 120 },
  { type: 'public_government', label: 'Government', color: '#C0B890', description: 'City Hall & admin · improves budget income',     cost: 150 },
];

const PUBLIC_TOOL_TYPES = new Set<string>(['public_education', 'public_security', 'public_government']);

// ── Main tool definitions ─────────────────────────────────────────────────────

interface ToolDef {
  type:        ToolType | '__public__';
  label:       string;
  color:       string;
  key:         string;
  description: string;
}

const TOOLS: ToolDef[] = [
  { type: 'road',        label: 'Road',        color: '#7A7A7A', key: 'R', description: 'Lay infrastructure · connects zones' },
  { type: 'residential', label: 'Residential', color: '#F5C842', key: 'H', description: 'Housing — place Commercial on top for mixed-use' },
  { type: 'commercial',  label: 'Commercial',  color: '#4A8ECC', key: 'C', description: 'Commerce & retail' },
  { type: '__public__',  label: 'Public',      color: '#5BB85D', key: 'P', description: 'Institutions — education, security, government' },
  { type: 'employment',  label: 'Employment',  color: '#7A6EA8', key: 'E', description: 'Add employment floors to residential / commercial · click again to remove' },
  { type: 'demolish',    label: 'Demolish',    color: '#E05454', key: 'D', description: 'Clear zone · costs ¢25' },
];

const TOOL_COST: Partial<Record<string, number>> = {
  demolish:         25,
  road:             10,
  residential:      50,
  commercial:       75,
  public_education: 100,
  public_security:  120,
  public_government:150,
  employment:       80,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function Toolbar() {
  const { selectedTool, setSelectedTool, metrics } = useGameStore();
  const [pubOpen, setPubOpen] = useState(false);

  const pubBtnRef  = useRef<HTMLButtonElement>(null);
  const pubMenuRef = useRef<HTMLDivElement>(null);

  const isPublicActive = PUBLIC_TOOL_TYPES.has(selectedTool);
  const activeSub      = PUBLIC_SUBS.find(s => s.type === selectedTool);

  // P key → default to education; other keys map normally
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toUpperCase();
      if (k === 'P') { setSelectedTool('public_education'); setPubOpen(false); return; }
      const match = TOOLS.find(t => t.key === k && t.type !== '__public__');
      if (match) { setSelectedTool(match.type as ToolType); setPubOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelectedTool]);

  // Close pub menu on outside click
  useEffect(() => {
    if (!pubOpen) return;
    const handler = (e: MouseEvent) => {
      const outside =
        (!pubBtnRef.current  || !pubBtnRef.current.contains(e.target as Node)) &&
        (!pubMenuRef.current || !pubMenuRef.current.contains(e.target as Node));
      if (outside) setPubOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pubOpen]);

  // Hint row — resolved for both normal and public sub-tools
  const activeToolDef = isPublicActive ? activeSub : TOOLS.find(t => t.type === selectedTool);
  const zoneCost      = TOOL_COST[selectedTool] ?? 0;
  const canAfford     = metrics.budget >= zoneCost;

  return (
    <div className="toolbar">
      <div className="toolbar-inner">
        {TOOLS.map((tool) => {
          if (tool.type === '__public__') {
            const swatchColor = activeSub ? activeSub.color : tool.color;
            return (
              <div key="__public__" className="tool-group">
                <button
                  ref={pubBtnRef}
                  className={`tool-btn ${isPublicActive ? 'is-active' : ''}`}
                  onClick={() => setPubOpen(o => !o)}
                  title={tool.description}
                >
                  <span
                    className="tool-swatch"
                    style={{
                      background: swatchColor,
                      boxShadow: isPublicActive
                        ? `0 0 0 2px white, 0 0 0 3.5px ${swatchColor}`
                        : 'none',
                    }}
                  />
                  <span className="tool-label">{activeSub ? activeSub.label : tool.label}</span>
                  <kbd className="tool-key">{tool.key}</kbd>
                  <span className="tool-chevron">{pubOpen ? '▲' : '▼'}</span>
                </button>

                {pubOpen && (
                  <div ref={pubMenuRef} className="pub-submenu">
                    {PUBLIC_SUBS.map(sub => (
                      <button
                        key={sub.type}
                        className={`pub-sub-btn ${selectedTool === sub.type ? 'is-active' : ''}`}
                        onClick={() => { setSelectedTool(sub.type); setPubOpen(false); }}
                        title={sub.description}
                      >
                        <span
                          className="pub-sub-swatch"
                          style={{
                            background: sub.color,
                            boxShadow: selectedTool === sub.type
                              ? `0 0 0 2px white, 0 0 0 3px ${sub.color}`
                              : 'none',
                          }}
                        />
                        <span className="pub-sub-label">{sub.label}</span>
                        <span className="pub-sub-cost">¢{sub.cost}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <button
              key={tool.type}
              className={`tool-btn ${selectedTool === tool.type ? 'is-active' : ''}`}
              onClick={() => { setSelectedTool(tool.type as ToolType); setPubOpen(false); }}
              title={tool.description}
            >
              <span
                className="tool-swatch"
                style={{
                  background: tool.color,
                  boxShadow: selectedTool === tool.type
                    ? `0 0 0 2px white, 0 0 0 3.5px ${tool.color}`
                    : 'none',
                }}
              />
              <span className="tool-label">{tool.label}</span>
              <kbd className="tool-key">{tool.key}</kbd>
            </button>
          );
        })}
      </div>

      {activeToolDef && (
        <div className="toolbar-hint">
          <span>{activeToolDef.description}</span>
          {zoneCost > 0 && (
            <span className={`tool-cost ${canAfford ? '' : 'no-budget'}`}>
              ¢{zoneCost}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
