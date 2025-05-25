// Assuming the server is running on localhost:3000. This should ideally be configurable.
const API_BASE_URL = 'http://localhost:3000';

interface RsiProfileData {
  handle: string;
  displayName?: string;
  pfpUrl?: string;
  organizationLink?: string;
  organizationIconUrl?: string;
  organizationFullName?: string;
  organizationSid?: string;
  organizationRankName?: string;
  organizationRankCount?: number;
  citizenRecord?: string;
  enlistedDate?: string;
  pfpImageId?: string;
  organizationIconImageId?: string;
  userId?: string;
  organizationId?: string;
}

interface UserProfileDto {
  profile: RsiProfileData | null;
  // Other fields from UserProfileDto that are not relevant for avatar fetching are omitted for brevity
  // events: any[]; // Replace 'any' with actual type if needed elsewhere
  // baseStats: any | null; // Replace 'any' with actual type
  // shipStats: any[]; // Replace 'any' with actual type
  // rank: number | null;
  // favoriteShip: string | null;
  // selectedHeroBannerImageUrl: string | null;
}

/**
 * Fetches the avatar URL for a given user handle.
 * @param userHandle The RSI handle of the user.
 * @returns The avatar URL string if found, otherwise null.
 */
export async function fetchUserAvatarUrl(userHandle: string): Promise<string | null> {
  if (!userHandle || typeof userHandle !== 'string' || userHandle.trim() === '') {
    console.error('fetchUserAvatarUrl: Invalid userHandle provided.');
    return null;
  }

  const endpoint = `${API_BASE_URL}/users/${encodeURIComponent(userHandle)}`;

  try {
    const response = await fetch(endpoint);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`fetchUserAvatarUrl: User profile not found for handle "${userHandle}".`);
      } else {
        console.error(`fetchUserAvatarUrl: API request failed for handle "${userHandle}" with status ${response.status}.`);
      }
      return null;
    }

    const data: UserProfileDto = await response.json();

    if (data && data.profile && data.profile.pfpUrl) {
      return data.profile.pfpUrl;
    } else {
      console.warn(`fetchUserAvatarUrl: Avatar URL (pfpUrl) not found in response for handle "${userHandle}".`);
      return null;
    }
  } catch (error) {
    console.error(`fetchUserAvatarUrl: Error fetching user profile for handle "${userHandle}".`, error);
    return null;
  }
}