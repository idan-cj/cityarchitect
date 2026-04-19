import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { ToolType } from '../types/game';
import './Toolbar.css';

interface ToolDef {
  type:        ToolType;
  label:       string;
  color:       string;
  key:         string;
  description: string;
}

const TOOLS: ToolDef[] = [
  { type: 'road',        label: 'Road',        color: '#7A7A7A', key: 'R', description: 'Lay infrastructure · connects zones' },
  { type: 'residential', label: 'Residential', color: '#F5C842', key: 'H', description: 'Housing — place Commercial on top for mixed-use' },
  { type: 'commercial',  label: 'Commercial',  color: '#4A8ECC', key: 'C', description: 'Commerce & retail' },
  { type: 'public',      label: 'Public',      color: '#5BB85D', key: 'P', description: 'Institutions, schools, parks' },
  { type: 'employment',  label: 'Employment',  color: '#7A6EA8', key: 'E', description: 'Add employment floors to residential / commercial · click again to remove' },
  { type: 'demolish',   label: 'Demolish',    color: '#E05454', key: 'D', description: 'Clear zone · costs ¢25' },
];

export function Toolbar() {
  const { selectedTool, setSelectedTool, metrics } = useGameStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const match = TOOLS.find((t) => t.key === e.key.toUpperCase());
      if (match) setSelectedTool(match.type);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelectedTool]);

  const activeTool = TOOLS.find((t) => t.type === selectedTool);
  const zoneCost   = selectedTool === 'demolish' ? 25
                   : selectedTool === 'road'        ? 10
                   : selectedTool === 'residential'  ? 50
                   : selectedTool === 'commercial'   ? 75
                   : selectedTool === 'public'       ? 100
                   : selectedTool === 'employment'   ? 80
                   : 0;
  const canAfford  = metrics.budget >= zoneCost;

  return (
    <div className="toolbar">
      <div className="toolbar-inner">
        {TOOLS.map((tool) => (
          <button
            key={tool.type}
            className={`tool-btn ${selectedTool === tool.type ? 'is-active' : ''}`}
            onClick={() => setSelectedTool(tool.type)}
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
        ))}
      </div>

      {activeTool && (
        <div className="toolbar-hint">
          <span>{activeTool.description}</span>
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
