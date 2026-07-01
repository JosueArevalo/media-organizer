import type { ExportTargetType } from './export.service';

export type ExportProviderId = 'network-folder' | 'google-photos' | 'google-drive';

export type ExportProviderStatus = 'available' | 'spike' | 'planned';

export type ExportProviderVisual = 'folder' | 'photos' | 'drive';
export type ExportProviderTargetType = ExportTargetType | 'google-drive';

export type ExportProvider = {
  id: ExportProviderId;
  route: string;
  status: ExportProviderStatus;
  visual: ExportProviderVisual;
  targetType: ExportProviderTargetType;
  titleKey:
    | 'export.provider.networkFolder.title'
    | 'export.provider.googlePhotos.title'
    | 'export.provider.googleDrive.title';
  subtitleKey:
    | 'export.provider.networkFolder.subtitle'
    | 'export.provider.googlePhotos.subtitle'
    | 'export.provider.googleDrive.subtitle';
};

export const exportProviders: ExportProvider[] = [
  {
    id: 'network-folder',
    route: '/export/network-folder',
    status: 'available',
    visual: 'folder',
    targetType: 'network-folder',
    titleKey: 'export.provider.networkFolder.title',
    subtitleKey: 'export.provider.networkFolder.subtitle'
  },
  {
    id: 'google-photos',
    route: '/export/google-photos',
    status: 'available',
    visual: 'photos',
    targetType: 'google-photos',
    titleKey: 'export.provider.googlePhotos.title',
    subtitleKey: 'export.provider.googlePhotos.subtitle'
  },
  {
    id: 'google-drive',
    route: '/export/google-drive',
    status: 'planned',
    visual: 'drive',
    targetType: 'google-drive',
    titleKey: 'export.provider.googleDrive.title',
    subtitleKey: 'export.provider.googleDrive.subtitle'
  }
];
