import React from 'react';
import { SplashView } from '../src/components/SplashView';

// The AuthGate in _layout.tsx handles redirecting to the right place once auth
// state resolves. This route just keeps the branded splash on screen until it
// does, so there's no visual change at the hand-off.
export default function SplashScreen() {
  return <SplashView />;
}
