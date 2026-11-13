import { useEffect, useRef } from 'react';
import { call, useCall } from '../lib/zz';
import { cx } from './ui';

/** Plays one participant's camera or screen-share track (always muted: sound goes through LiveKit's own audio elements). */
export function VideoEl({ identity, source, contain }: { identity: string; source: 'screen' | 'camera'; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const version = useCall((c) => c.trackVersion);
  useEffect(() => {
    const el = ref.current;
    const track = call.getVideoTrack(identity, source);
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [identity, source, version]);
  return <video ref={ref} autoPlay playsInline muted className={cx('size-full bg-black', contain ? 'object-contain' : 'object-cover')} />;
}
