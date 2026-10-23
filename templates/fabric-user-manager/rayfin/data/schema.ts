import { GovConfig } from './GovConfig.js';
import { UmAudit } from './UmAudit.js';
import { UmBinding } from './UmBinding.js';
import { UmGroupContact } from './UmGroupContact.js';
import { UmManagedGroup } from './UmManagedGroup.js';
import { UmRequest } from './UmRequest.js';
import { UmReviewDate } from './UmReviewDate.js';

/**
 * Schema type definition for Fabric User Manager.
 *
 * Only the app's own records live here: which groups are activated, what an admin recorded about
 * them, requests, review dates, contacts, the change log, and settings (GovConfig, a key/value table
 * that keeps its name from the Governance Hub this app grew out of). Deploy it to its own item: pointed
 * at an existing Governance Hub item, it would no longer declare the Hub's other tables.
 * Members, owners and workspace roles are never stored: they are read live from Entra and Fabric.
 */
export type DataAppSchema = {
  GovConfig: GovConfig;
  UmAudit: UmAudit;
  UmBinding: UmBinding;
  UmGroupContact: UmGroupContact;
  UmManagedGroup: UmManagedGroup;
  UmRequest: UmRequest;
  UmReviewDate: UmReviewDate;
};

export const schema = [GovConfig, UmAudit, UmBinding, UmGroupContact, UmManagedGroup, UmRequest, UmReviewDate];
