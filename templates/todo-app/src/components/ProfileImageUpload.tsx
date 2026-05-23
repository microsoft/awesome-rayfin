import { useCallback, useState } from 'react';

import { useProfileImage } from '../hooks/useProfileImage';

interface ProfileImageUploadProps {
  /**
   * Optional userId for showing the current persisted image during signup.
   * When undefined, component falls back to default avatar until a preview is selected.
   */
  userId?: string;
  /**
   * Deferred selection callback. Called after validation with the selected file and its preview URL.
   */
  onImageSelected?: (file: File, previewUrl: string) => void;
  className?: string;
}

/**
 * Component for uploading profile images with drag-and-drop support and preview
 */
export function ProfileImageUpload({
  userId,
  onImageSelected,
  className = '',
}: ProfileImageUploadProps) {
  // Note: In deferred mode, we only read existing image (if userId provided) and never upload here.
  const {
    isLoading,
    error: loadError,
    getDisplayUrl,
  } = useProfileImage(userId);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFileChange = useCallback(
    async (file: File | null) => {
      if (!file) {
        setPreviewUrl(null);
        setValidationError(null);
        return;
      }

      // Validate basic constraints here for fast feedback
      const allowed = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
      ];
      const maxSize = 2 * 1024 * 1024; // 2MB
      if (!allowed.includes(file.type)) {
        setValidationError(
          'Please select a valid image file (JPEG, PNG, GIF, or WebP)'
        );
        setPreviewUrl(null);
        return;
      }
      if (file.size > maxSize) {
        setValidationError('Image file must be smaller than 2MB');
        setPreviewUrl(null);
        return;
      }

      setValidationError(null);

      try {
        // Show preview immediately
        const reader = new FileReader();
        reader.onload = (e) => {
          const url = e.target?.result as string;
          setPreviewUrl(url);
          onImageSelected?.(file, url);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        setValidationError('Failed to read image file');
        setPreviewUrl(null);
      }
    },
    [onImageSelected]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    handleFileChange(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFileChange(file);
    }
  };

  const currentImageUrl = previewUrl || getDisplayUrl();

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Current/Preview Image */}
      <div className="flex justify-center">
        <img
          src={currentImageUrl}
          alt="Profile preview"
          className="w-24 h-24 rounded-full object-cover border-2 border-gray-200"
        />
      </div>

      {/* Upload Area */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
          ${
            isDragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }
          ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('profile-image-input')?.click()}
      >
        <input
          id="profile-image-input"
          type="file"
          accept="image/*"
          onChange={handleInputChange}
          className="hidden"
          disabled={isLoading}
        />

        <div className="space-y-2">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
          >
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="text-sm text-gray-600">
            {isLoading ? (
              <p>Uploading...</p>
            ) : (
              <>
                <p>
                  <span className="font-medium text-blue-600 hover:text-blue-500">
                    Click to upload
                  </span>{' '}
                  or drag and drop
                </p>
                <p className="text-xs">PNG, JPG, GIF up to 2MB</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Error Messages */}
      {validationError && (
        <div className="text-sm text-red-600 text-center">
          {validationError}
        </div>
      )}
      {loadError && (
        <div className="text-sm text-red-600 text-center">{loadError}</div>
      )}
    </div>
  );
}
