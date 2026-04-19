import { useGameStore } from '../store/gameStore';
import { Milestone, MilestoneType } from '../types/game';
import './Timeline.css';

const TYPE_COLOR: Record<MilestoneType, string> = {
  start:      '#1a1a1a',
  zone:       '#888888',
  population: '#4A8ECC',
  health:     '#5BB85D',
  phase:      '#E08000',
};

export function Timeline() {
  const { milestones, metrics } = useGameStore();
  const currentTick = metrics.tick;

  const maxTick = Math.max(currentTick, 1);

  // Non-first milestones map to 18 %–84 %, leaving the left edge for
  // "City Founded" and the right edge for the "Now" diamond.
  const pct = (tick: number) =>
    Math.min(84, Math.max(18, (tick / maxTick) * 66 + 18));

  const yearLabel = (tick: number) => `Yr ${Math.floor(tick / 4)}`;

  return (
    <div className="tl-wrap">
      <div className="tl-panel">

        {/* Axis line */}
        <div className="tl-axis" />

        {/* Milestone events */}
        {milestones.map((m: Milestone, i: number) => (
          <div
            key={m.id}
            className={`tl-event ${i % 2 === 0 ? 'tl-above' : 'tl-below'} ${i === 0 ? 'tl-first' : ''}`}
            style={{ left: i === 0 ? '0%' : `${pct(m.tick)}%` }}
          >
            <span className="tl-label" style={{ color: TYPE_COLOR[m.type] }}>
              {m.label}
            </span>
            <div className="tl-dot" style={{ background: TYPE_COLOR[m.type] }} />
            <span className="tl-year">{yearLabel(m.tick)}</span>
          </div>
        ))}

        {/* Now marker — always at the right edge */}
        <div className="tl-now">
          <span className="tl-now-label">Now</span>
          <div className="tl-now-diamond" />
          <span className="tl-now-year">{yearLabel(currentTick)}</span>
        </div>

      </div>
    </div>
  );
}
