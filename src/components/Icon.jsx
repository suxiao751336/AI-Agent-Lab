const ICONS = {
  back: ['M19 12H5', 'm12 19-7-7 7-7'],
  send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  chart: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-6'],
  sparkles: [
    'm12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3Z',
  ],
  play: ['M6 3 20 12 6 21 6 3'],
  refresh: ['M21 12a9 9 0 1 1-2.64-6.36L21 8', 'M21 3v5h-5'],
  check: ['M20 6 9 17l-5-5'],
  copy: [
    'M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z',
    'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  ],
  monitor: ['M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'M8 21h8', 'M12 17v4'],
  phone: ['M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z', 'M12 18h.01'],
  stop: ['M7 7h10v10H7Z'],
  pencil: ['M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  zap: ['M13 2 3 14h7l-1 8 11-14h-8l1-6Z'],
  target: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
    'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
    'M12 12h.01',
  ],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm21 21-4.3-4.3'],
  mail: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'm3 7 9 6 9-6'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  image: [
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z',
    'M9 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
    'm21 16-4.6-4.6a2 2 0 0 0-2.8 0L4 21',
  ],
  locate: [
    'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
    'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    'M12 2v3',
    'M12 19v3',
    'M2 12h3',
    'M19 12h3',
  ],
  upload: ['M12 15V3', 'm7 8 5-5 5 5', 'M5 21h14'],
  compass: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'm16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z'],
  chevronDown: ['m6 9 6 6 6-6'],
  messageSquare: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v5l3 2'],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: [
    'M3 6h18',
    'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2',
    'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
    'M10 11v6',
    'M14 11v6',
  ],
}

export default function Icon({ name, size = 16, className = '', strokeWidth = 2 }) {
  const paths = ICONS[name]
  if (!paths) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
