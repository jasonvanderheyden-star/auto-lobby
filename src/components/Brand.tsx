export function MaceMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
         className={className} aria-hidden="true">
      <line x1="24" y1="1.6" x2="24" y2="5"     stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="18.4" y1="3.3" x2="20.2" y2="6.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="29.6" y1="3.3" x2="27.8" y2="6.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="24" cy="13" r="7.3" stroke="currentColor" strokeWidth="3.6"/>
      <circle cx="24" cy="13" r="2.5" fill="#5B6CF0"/>
      <rect x="21.4" y="19.5" width="5.2" height="18.6" rx="2.6" fill="currentColor"/>
      <rect x="16.5" y="38.1" width="15" height="4.6" rx="2.3" fill="currentColor"/>
    </svg>
  );
}

/** App-icon tile: mace on ink, matching brand/01-logo/whiphand-icon.svg */
export function BrandTile({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center justify-center rounded-md bg-[#21243A] border border-[#343A52] text-white"
          style={{ width: size, height: size }}>
      <MaceMark size={size * 0.62} />
    </span>
  );
}

/** Horizontal lockup for the top nav */
export function BrandLockup() {
  return (
    <span className="flex items-center gap-2 text-slate-800">
      <BrandTile size={28} />
      <span className="font-semibold tracking-tight">Auto Lobby</span>
      <span className="font-mono text-[10px] tracking-wide text-stone-500 uppercase">
        powered by Whiphand
      </span>
    </span>
  );
}
