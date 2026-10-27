'use client';

import { useDeferredValue, type ReactNode } from 'react';

interface Props {
  active: boolean;
  children: ReactNode;
}

export default function DeferredAtlasControls({ active, children }: Props) {
  const deferredActive = useDeferredValue(active);
  return active && deferredActive ? children : null;
}
