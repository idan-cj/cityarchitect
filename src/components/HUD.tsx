import { useGameStore } from '../store/gameStore';
import './HUD.css';

export function HUD() {
  const { metrics, diagnosticMode, toggleDiagnostic } = useGameStore();

  return (
    <div className="hud">
      <div className="hud-panel metrics-panel">
        <div className="city-title">
          City<span>Architect</span> <em>2026</em>
        </div>

        <div className="metrics">
          <Metric label="Budget"      value={`¢ ${Math.round(metrics.budget).toLocaleString()}`} />
          <MetricBar label="City Health" value={metrics.cityHealth} color="#5BB85D" />
          <Metric label="Population"  value={metrics.population.toLocaleString()} />
          <MetricBar label="Education"   value={metrics.education}  color="#4A8ECC" />
          <MetricBar label="Walkability" value={metrics.walkability} color="#F5C842" />
        </div>

        <div className="tick-label">Cycle {metrics.tick}</div>
      </div>

      <div className="hud-top-right">
        <button
          className={`btn-diagnostic ${diagnosticMode ? 'is-active' : ''}`}
          onClick={toggleDiagnostic}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="7" cy="7" r="2"   fill="currentColor"/>
          </svg>
          {diagnosticMode ? 'Diagnosis On' : 'Diagnosis'}
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="metric-row">
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <span className="metric-pct">{value}%</span>
      </div>
      <div className="metric-track">
        <div className="metric-fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
