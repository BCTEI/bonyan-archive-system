/** Manifest stored plaintext in a .bonyan-backup header — previewed before restore. */
export interface BackupManifest {
  app: string;
  appVersion: string;
  createdAt: string;
  createdBy: string;
  dbSizeBytes: number;
  sha256: string;
  counts: { documents: number; archivedYears: number; folders: number; users: number };
}
