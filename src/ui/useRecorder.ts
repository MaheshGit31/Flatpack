import { useSyncExternalStore } from 'react';
import { recorder, type RecorderState } from '../capture/recorder';

export function useRecorder(): RecorderState {
  const r = recorder();
  return useSyncExternalStore(r.subscribe, r.getSnapshot);
}
