import { useEffect, useRef } from 'react';
import { GameEngine } from './game/GameEngine';
import { HUD } from './components/HUD';
import { Toolbar } from './components/Toolbar';
import { Timeline } from './components/Timeline';
import './App.css';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || engineRef.current) return;

    // Defer one frame so the canvas has its final layout dimensions.
    const id = requestAnimationFrame(() => {
      engineRef.current = new GameEngine(canvas);
    });

    return () => {
      cancelAnimationFrame(id);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="game-canvas" />
      <HUD />
      <Timeline />
      <Toolbar />
    </div>
  );
}
