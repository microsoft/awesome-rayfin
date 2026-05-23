import { useCallback, useState } from 'react';

import { useProfileImage } from '../hooks/useProfileImage';

import { ProfileImageUpload } from './ProfileImageUpload';

interface ProfileImageModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for updating profile images with deferred upload
 */
export function ProfileImageModal({
  userId,
  isOpen,
  onClose,
}: ProfileImageModalProps) {
  const { uploadProfileImage, isLoading, error } = useProfileImage(userId);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleImageSelected = useCallback((file: File) => {
    setSelectedFile(file);
    setUploadError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedFile) return;

    try {
      setUploadError(null);
      await uploadProfileImage(userId, selectedFile);

      // Dispatch event to notify other components of the update
      window.dispatchEvent(
        new CustomEvent('profile-image-updated', {
          detail: { userId },
        })
      );

      // Reset state and close modal
      setSelectedFile(null);
      onClose();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to upload image'
      );
    }
  }, [selectedFile, userId, uploadProfileImage, onClose]);

  const handleClose = useCallback(() => {
    setSelectedFile(null);
    setUploadError(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Update Profile Image
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        <ProfileImageUpload
          userId={userId}
          onImageSelected={handleImageSelected}
          className="mb-4"
        />

        {uploadError && (
          <div className="text-sm text-red-600 text-center mb-4">
            {uploadError}
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 text-center mb-4">{error}</div>
        )}

        <div className="flex justify-end space-x-3">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !selectedFile}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
