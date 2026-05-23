import { useProfileImage } from '../hooks/useProfileImage';
import { ServiceContainer } from '../services/ServiceContainer';

interface ProfileImageProps {
  userId: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
  onClick?: () => void;
  clickable?: boolean;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
  xl: 'w-24 h-24',
};

/**
 * Component for displaying a user's profile image with fallback to default avatar
 */
export function ProfileImage({
  userId,
  size = 'md',
  className = '',
  alt,
  onClick,
  clickable = false,
}: ProfileImageProps) {
  const { getDisplayUrl, error } = useProfileImage(userId);

  const sizeClass = sizeClasses[size];
  const displayUrl = getDisplayUrl();

  if (error) {
    console.warn('Profile image error:', error);
  }

  const handleClick = () => {
    if (clickable && onClick) {
      onClick();
    }
  };

  return (
    <img
      src={displayUrl}
      alt={alt || 'Profile image'}
      className={`${
        sizeClass
      } rounded-full object-cover border-2 border-gray-200 ${
        clickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
      } ${className}`}
      onClick={handleClick}
      onError={(e) => {
        // If the image fails to load, fall back to default avatar
        const target = e.target as HTMLImageElement;
        const profileImageService =
          ServiceContainer.create().profileImageService;
        target.src = profileImageService.getDefaultAvatar();
      }}
    />
  );
}
