import type { SessionDTO } from '@zirzircord/shared';
import { useState } from 'react';
import { colorFor, initials } from '../lib/format';
import { cx } from './ui';

/**
 * A session's picture (set sessions can have one) or its coloured initials.
 * Animated pictures play only while hovered, like avatars.
 */
export function SessionPicture({ s, className, animate }: { s: Pick<SessionDTO, 'id' | 'name' | 'iconUrl' | 'iconStaticUrl'>; className?: string; animate?: boolean }) {
  const [hover, setHover] = useState(false);
  const [broken, setBroken] = useState(false);
  const url = animate || hover ? s.iconUrl : (s.iconStaticUrl ?? s.iconUrl);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cx('shrink-0 object-cover', className)}
      />
    );
  }
  return (
    <div className={cx('grid shrink-0 place-items-center font-semibold text-white', className)} style={{ background: colorFor(s.id) }}>
      {initials(s.name)}
    </div>
  );
}
