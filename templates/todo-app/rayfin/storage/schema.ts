import type { ProfileImage } from './ProfileImage.js';

/**
 * Storage schema type definition for your Rayfin project
 *
 * This type maps storage folder names to their corresponding types,
 * enabling full type safety throughout the application when using
 * the RayfinClient and Storage API.
 *
 * Add additional storage folders to this schema as you create them:
 *
 * ```ts
 * export type TodoAppStorageSchema = {
 *   ExampleStorage: ExampleStorage;
 *   UserUploads: UserUploads;
 *   Documents: Documents;
 * };
 * ```
 */
export type TodoAppStorageSchema = {
  ProfileImage: ProfileImage;
};
