import type { ExportProviderVisual } from '../services/export-providers';

type ExportProviderIconProps = {
  visual: ExportProviderVisual;
};

const NetworkFolderIcon = () => (
  <svg className="export-provider-icon" viewBox="0 0 64 64" role="img" aria-label="Network folder">
    <path d="M10 22a6 6 0 0 1 6-6h13l5 6h14a6 6 0 0 1 6 6v2H10v-8Z" fill="#FFD166" />
    <path d="M10 28h44v18a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6V28Z" fill="#F5B84B" />
    <path d="M41 38h7" stroke="#8A6623" strokeWidth="3" strokeLinecap="round" />
    <path d="M45 44c3.5 0 6-2 6-5s-2.5-5-6-5" fill="none" stroke="#8A6623" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const GooglePhotosIcon = () => (
  <svg className="export-provider-icon" viewBox="0 0 64 64" role="img" aria-label="Google Photos">
    <path d="M31.8 31.8 18.4 45.2a9.4 9.4 0 0 0 13.3 13.3l13.4-13.4-13.3-13.3Z" fill="#4285F4" />
    <path d="M32.2 31.8 18.8 18.4A9.4 9.4 0 0 0 5.5 31.7l13.4 13.4 13.3-13.3Z" fill="#EA4335" />
    <path d="M32.2 32.2 45.6 18.8A9.4 9.4 0 0 0 32.3 5.5L18.9 18.9l13.3 13.3Z" fill="#FBBC04" />
    <path d="M31.8 32.2 45.2 45.6a9.4 9.4 0 0 0 13.3-13.3L45.1 18.9 31.8 32.2Z" fill="#34A853" />
    <circle cx="32" cy="32" r="8" fill="#1F2937" opacity="0.18" />
  </svg>
);

const GoogleDriveIcon = () => (
  <svg className="export-provider-icon" viewBox="0 0 64 64" role="img" aria-label="Google Drive">
    <path d="M24.2 8h15.6L58 39.5H42.4L24.2 8Z" fill="#FBBC04" />
    <path d="M6 39.5 24.2 8l7.8 13.5-10.4 18H6Z" fill="#34A853" />
    <path d="M21.6 39.5h36.4L50.2 53H13.8l7.8-13.5Z" fill="#4285F4" />
    <path d="m13.8 53 7.8-13.5H6L13.8 53Z" fill="#188038" />
    <path d="m50.2 53 7.8-13.5H42.4L50.2 53Z" fill="#1967D2" />
  </svg>
);

export const ExportProviderIcon = ({ visual }: ExportProviderIconProps) => {
  const icon = (() => {
    if (visual === 'photos') return <GooglePhotosIcon />;
    if (visual === 'drive') return <GoogleDriveIcon />;
    return <NetworkFolderIcon />;
  })();

  return (
    <div className={`export-provider-visual export-provider-visual-${visual}`} aria-hidden="true">
      {icon}
    </div>
  );
};
