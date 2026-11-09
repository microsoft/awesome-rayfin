import { Navigate, Route } from 'react-router-dom';

import { GuidelinesPage } from '@/um/components/GuidelinesPage';
import { GuidelinesSetupPage } from '@/um/components/GuidelinesSetup';
import { PersonPage } from '@/um/components/PersonPage';
import { SetupPage } from '@/um/components/SetupPage';
import { TargetTab } from '@/um/components/TargetTab';
import { UM_PATHS } from '@/um/domain/profile';

/** The Fabric User Manager's routes. */
export function umRouteElements() {
  return (
    <>
      <Route path={UM_PATHS.root} element={<Navigate to={UM_PATHS.workspaces} replace />} />
      <Route path={UM_PATHS.workspaces} element={<TargetTab kind="Workspace" />} />
      <Route path={UM_PATHS.audiences} element={<TargetTab kind="Audience" />} />
      <Route path={UM_PATHS.modelRoles} element={<TargetTab kind="ModelRole" />} />
      <Route path={UM_PATHS.guidelines} element={<GuidelinesPage />} />
      <Route path={UM_PATHS.setup} element={<SetupPage />} />
      <Route path={UM_PATHS.guidelinesSetup} element={<GuidelinesSetupPage />} />
      <Route path={UM_PATHS.person} element={<PersonPage />} />
    </>
  );
}
