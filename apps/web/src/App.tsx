import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { useCompressionSessionState } from './hooks/useCompressionJobState';
import { useImportStepCompletion } from './hooks/useImportStepCompletion';
import CompressionPage from './pages/CompressionPage';
import DashboardPage from './pages/DashboardPage';
import ExportPage from './pages/ExportPage';
import GoogleDriveExportPage from './pages/GoogleDriveExportPage';
import GooglePhotosExportPage from './pages/GooglePhotosExportPage';
import GroupingPage from './pages/GroupingPage';
import ImportPage from './pages/ImportPage';
import NetworkFolderExportPage from './pages/NetworkFolderExportPage';
import SelectionPage from './pages/SelectionPage';
import SettingsPage from './pages/SettingsPage';
import { useGroupingSessionState } from './hooks/useGroupingJobState';

const GuardedWorkflowStep = ({ children }: { children: JSX.Element }) => {
  const isImportStepComplete = useImportStepCompletion();

  if (!isImportStepComplete) {
    return <Navigate to="/import" replace />;
  }

  return children;
};

const GuardedGroupingStep = ({ children }: { children: JSX.Element }) => {
  const isImportStepComplete = useImportStepCompletion();
  const compressionSessionState = useCompressionSessionState();

  if (!isImportStepComplete) {
    return <Navigate to="/import" replace />;
  }

  if (compressionSessionState.status !== 'completed') {
    return <Navigate to="/compression" replace />;
  }

  return children;
};

const GuardedExportStep = ({ children }: { children: JSX.Element }) => {
  const isImportStepComplete = useImportStepCompletion();
  const compressionSessionState = useCompressionSessionState();
  const groupingSessionState = useGroupingSessionState();

  if (!isImportStepComplete) {
    return <Navigate to="/import" replace />;
  }

  if (compressionSessionState.status !== 'completed') {
    return <Navigate to="/compression" replace />;
  }

  if (groupingSessionState.status !== 'completed' && !groupingSessionState.outputRootLabel) {
    return <Navigate to="/grouping" replace />;
  }

  return children;
};

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/selection"
            element={
              <GuardedWorkflowStep>
                <SelectionPage />
              </GuardedWorkflowStep>
            }
          />
          <Route path="/preview" element={<Navigate to="/selection" replace />} />
          <Route
            path="/compression"
            element={
              <GuardedWorkflowStep>
                <CompressionPage />
              </GuardedWorkflowStep>
            }
          />
          <Route
            path="/grouping"
            element={
              <GuardedGroupingStep>
                <GroupingPage />
              </GuardedGroupingStep>
            }
          />
          <Route
            path="/export"
            element={
              <GuardedExportStep>
                <ExportPage />
              </GuardedExportStep>
            }
          />
          <Route
            path="/export/network-folder"
            element={
              <GuardedExportStep>
                <NetworkFolderExportPage />
              </GuardedExportStep>
            }
          />
          <Route
            path="/export/google-photos"
            element={
              <GuardedExportStep>
                <GooglePhotosExportPage />
              </GuardedExportStep>
            }
          />
          <Route
            path="/export/google-drive"
            element={
              <GuardedExportStep>
                <GoogleDriveExportPage />
              </GuardedExportStep>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
