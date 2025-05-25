<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { fetchUserAvatarUrl } from '../services/userService';

const props = defineProps<{
  userHandle: string;
  size?: number; // Optional size for the avatar
}>();

const avatarUrl = ref<string | null>(null);
const isLoading = ref(true);
const hasError = ref(false);

const defaultAvatar = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cGF0aCBmaWxsPSIjY2NjY2NjIiBkPSJNMjguMjUgMjQuNzYxYy0uNDUtMS41MjQtMS4xNzMtMi44ODMtMi4xMS00LjA0N2MtMS4wMS0xLjIzNi0yLjQzLTEuOTM4LTMuNzYyLTIuNDM4Yy0uMDQtLjAxMi0uMDYtLjAzNS0uMDYtLjA3NWMwLS4wMy4wMTItLjA2My4wMzYtLjA4NmMxLjE5Ni0xLjA5NCAxLjg3OC0yLjU5NCAxLjg3OC00LjE5MWMwLTEuNDA0LS41NjQtMi43ODQtMS41Ny0zLjc4OGMtMS4wMDgtMS4wMDUtMi4zOS0xLjU2OC0zLjc5My0xLjU2OGMtMS40MDMgMC0yLjc4NS41NjMtMy43OTQgMS41NjhjLTEuMDA2IDEuMDA1LTEuNTY4IDIuMzg1LTEuNTY4IDMuNzg4YzAgMS41OTcuNjgxIDMuMDk3IDEuODc3IDQuMTkxYzAuMDI0LjAyMy4wMzUuMDU1LjAzNS4wODZjMCAuMDQtLjAyMy4wNjQtLjA2LjA3NWMtMS4zMzIuNS0yLjc1MyAxLjItMy43NjIgMi40MzhjLS45MzggMS4xNjQtMS42NTcgMi41MjMtMi4xMSA0LjA0N2MtLjA0NC4xNDcuMDEuMzAyLjEzNi4zODhjLjEyNi4wODUuMjg0LjEyNy40NDIuMTI3aDIwLjQxN2MuMTU3IDAgLjMxNi0uMDQyLjQ0MS0uMTI3Yy4xMjctLjA4Ni4xOC0uMjQxLjEzNy0uMzg4ek0xNiA3LjQ4MWMuOTYgMCAxLjg1My4zNzggMi41MzggMS4wNjNjLjY4NC42ODMuMS4wNjMgMS42NDQuMS4wNjMgMi41MzdjMCAuOTYtLjM3OCAxLjg1My0xLjA2MyAyLjUzOGMtLjY4My42ODQtMS41NzggMS4wNjQtMi41MzggMS4wNjRjLS45NiAwLTEuODUzLS4zOC0yLjUzOC0xLjA2NGMtLjY4My0uNjg1LTEuMDYzLTEuNTc4LTEuMDYzLTIuNTM4YzAtLjk2LjM4LTEuODU0IDEuMDYzLTIuNTM3Yy42ODUtLjY4NCAxLjU3OC0xLjA2MyAyLjUzOC0xLjA2M3oiLz48L3N2Zz4='; // Simple grey SVG placeholder

const fetchAvatar = async (handle: string) => {
  if (!handle) {
    avatarUrl.value = null;
    isLoading.value = false;
    hasError.value = true; // No handle is an error state for fetching
    return;
  }
  isLoading.value = true;
  hasError.value = false;
  try {
    const url = await fetchUserAvatarUrl(handle);
    avatarUrl.value = url;
  } catch (error) {
    console.error(`Error fetching avatar for ${handle}:`, error);
    avatarUrl.value = null;
    hasError.value = true;
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  fetchAvatar(props.userHandle);
});

watch(() => props.userHandle, (newUserHandle) => {
  fetchAvatar(newUserHandle);
});

const handleError = () => {
  hasError.value = true; // Mark as error if image fails to load
  avatarUrl.value = null; // Clear potentially broken URL
};
</script>

<template>
  <div class="user-avatar-container" :style="{ width: size ? `${size}px` : '32px', height: size ? `${size}px` : '32px' }">
    <template v-if="isLoading">
      <!-- Optional: Loading spinner or skeleton -->
      <img :src="defaultAvatar" alt="Loading avatar" class="avatar-image placeholder" />
    </template>
    <template v-else-if="avatarUrl && !hasError">
      <img :src="avatarUrl" :alt="`${userHandle}'s avatar`" class="avatar-image" @error="handleError" />
    </template>
    <template v-else>
      <img :src="defaultAvatar" alt="Default avatar" class="avatar-image placeholder" />
    </template>
  </div>
</template>

<style scoped>
.user-avatar-container {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  background-color: #333; /* Fallback background */
  border: 1px solid #444;
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-image.placeholder {
  opacity: 0.7;
}
</style>