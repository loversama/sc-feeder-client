<template>
  <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
    <!-- Master Toggle -->
    <div class="flex items-center justify-between mb-4">
      <h4 class="text-lg font-semibold text-theme-text-white">Play Event Sounds</h4>
      <el-switch
        v-model="soundPreferences.enabled"
        @change="updatePreferences"
      />
    </div>
    
    <!-- Sound Customization (shown when enabled) -->
    <transition name="fade">
      <div v-if="soundPreferences.enabled" class="mt-6 space-y-4">
        <p class="text-gray-400 text-sm mb-4">Customize sounds for different event types:</p>
        
        <!-- Event Type Sound Settings -->
        <div v-for="(config, eventType) in eventTypes" :key="eventType" 
             class="flex items-center gap-2 py-3 border-b border-theme-border/50 last:border-0">
          <!-- Event Label -->
          <span class="text-theme-text-light min-w-[140px]">{{ config.label }}</span>
          
          <!-- Sound Type Selector - Balanced size -->
          <el-select 
            v-model="soundPreferences.eventSounds[eventType].type"
            @change="handleTypeChange(eventType)"
            size="small"
            class="w-24 sound-select"
          >
            <el-option value="default" label="Default" />
            <el-option value="custom" label="Custom..." />
            <el-option value="none" label="None" />
          </el-select>
          
          <!-- Custom File Display/Selector -->
          <el-button
            v-if="soundPreferences.eventSounds[eventType].type === 'custom'"
            @click="selectCustomSound(eventType)"
            size="small"
            type="info"
            plain
            class="custom-file-button"
          >
            <el-icon>
              <Folder />
            </el-icon>
            <span class="ml-1 file-name">
              {{ getTruncatedFileName(soundPreferences.eventSounds[eventType].path) || 'Choose File' }}
            </span>
          </el-button>
          
          <!-- Volume Slider - Takes up more space -->
          <div class="flex items-center gap-2 flex-1 mr-3">
            <el-icon class="text-theme-text-light">
              <span class="i-tabler-volume text-sm" />
            </el-icon>
            <el-slider
              v-model="soundPreferences.eventSounds[eventType].volume"
              :min="0"
              :max="1"
              :step="0.1"
              :show-tooltip="false"
              @change="updatePreferences"
              size="small"
              class="flex-1"
              style="min-width: 120px;"
              :disabled="soundPreferences.eventSounds[eventType].type === 'none'"
            />
            <span class="text-xs text-theme-text-light min-w-[35px] text-right">
              {{ Math.round((soundPreferences.eventSounds[eventType].volume || 0.5) * 100) }}%
            </span>
          </div>
          
          <!-- Test Button -->
          <el-button
            @click="testSound(eventType)"
            :disabled="soundPreferences.eventSounds[eventType].type === 'none'"
            size="small"
            circle
            class="test-sound-btn"
          >
            <el-icon class="play-icon">
              <CaretRight />
            </el-icon>
          </el-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { CaretRight, Folder } from '@element-plus/icons-vue';
import type { SoundPreferences, SoundConfig } from '../../shared/types';

// Debounce helper
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

// Props
const props = defineProps<{
  modelValue?: boolean; // For backward compatibility with the old toggle
}>();

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'preferences-updated': [preferences: SoundPreferences];
}>();

// Event type configuration
const eventTypes = {
  vehicleDestruction: { label: 'Vehicle Destruction', icon: 'explosion' },
  crash: { label: 'Vehicle Crash', icon: 'car-crash' },
  playerKill: { label: 'Player Kill', icon: 'crosshairs' },
  npcKill: { label: 'NPC Kill', icon: 'robot' },
  playerDeath: { label: 'Your Death', icon: 'skull' },
} as const;

// State
const soundPreferences = ref<SoundPreferences>({
  enabled: true,
  eventSounds: {
    vehicleDestruction: { type: 'default', path: 'clean_pop', volume: 0.6 },
    crash: { type: 'default', path: 'metallic_din_2', volume: 0.7 },
    playerKill: { type: 'default', path: 'metallic_din_1', volume: 0.5 },
    npcKill: { type: 'default', path: 'metallic_din_npc', volume: 0.4 },
    playerDeath: { type: 'default', path: 'cranial_snap', volume: 0.8 },
  }
});

// Load sound preferences on mount
onMounted(async () => {
  try {
    if (window.logMonitorApi?.getSoundPreferences) {
      const prefs = await window.logMonitorApi.getSoundPreferences();
      
      // Ensure all volumes have valid values
      for (const eventType of Object.keys(prefs.eventSounds) as Array<keyof typeof eventTypes>) {
        if (prefs.eventSounds[eventType].volume === undefined || prefs.eventSounds[eventType].volume === null) {
          prefs.eventSounds[eventType].volume = soundPreferences.value.eventSounds[eventType].volume;
        }
      }
      
      soundPreferences.value = prefs;
      
      // Emit the enabled state for backward compatibility
      emit('update:modelValue', prefs.enabled);
    }
  } catch (error) {
    console.error('Failed to load sound preferences:', error);
  }
});

// Watch for external changes to the modelValue (backward compatibility)
watch(() => props.modelValue, (newValue) => {
  if (newValue !== undefined && newValue !== soundPreferences.value.enabled) {
    soundPreferences.value.enabled = newValue;
    updatePreferences();
  }
});

// Update preferences in the backend (with debouncing)
const updatePreferencesImmediate = async () => {
  try {
    if (window.logMonitorApi?.setSoundPreferences) {
      // Create a clean copy to avoid circular references
      // Ensure all volumes are valid numbers
      const ensureValidVolume = (vol: any): number => {
        const v = parseFloat(vol);
        return isNaN(v) ? 0.5 : Math.max(0, Math.min(1, v));
      };
      
      const prefsToSave = {
        enabled: Boolean(soundPreferences.value.enabled),
        eventSounds: {
          vehicleDestruction: {
            type: soundPreferences.value.eventSounds.vehicleDestruction.type || 'default',
            path: soundPreferences.value.eventSounds.vehicleDestruction.path || 'clean_pop',
            volume: ensureValidVolume(soundPreferences.value.eventSounds.vehicleDestruction.volume)
          },
          crash: {
            type: soundPreferences.value.eventSounds.crash.type || 'default',
            path: soundPreferences.value.eventSounds.crash.path || 'metallic_din_2',
            volume: ensureValidVolume(soundPreferences.value.eventSounds.crash.volume)
          },
          playerKill: {
            type: soundPreferences.value.eventSounds.playerKill.type || 'default',
            path: soundPreferences.value.eventSounds.playerKill.path || 'metallic_din_1',
            volume: ensureValidVolume(soundPreferences.value.eventSounds.playerKill.volume)
          },
          npcKill: {
            type: soundPreferences.value.eventSounds.npcKill.type || 'default',
            path: soundPreferences.value.eventSounds.npcKill.path || 'metallic_din_npc',
            volume: ensureValidVolume(soundPreferences.value.eventSounds.npcKill.volume)
          },
          playerDeath: {
            type: soundPreferences.value.eventSounds.playerDeath.type || 'default',
            path: soundPreferences.value.eventSounds.playerDeath.path || 'cranial_snap',
            volume: ensureValidVolume(soundPreferences.value.eventSounds.playerDeath.volume)
          }
        }
      };
      
      console.log('Saving sound preferences:', prefsToSave);
      const result = await window.logMonitorApi.setSoundPreferences(prefsToSave);
      console.log('Save result:', result);
      
      if (result) {
        emit('update:modelValue', soundPreferences.value.enabled);
        emit('preferences-updated', soundPreferences.value);
      } else {
        console.warn('setSoundPreferences returned false');
      }
    }
  } catch (error) {
    console.error('Failed to update sound preferences:', error);
    // Don't show error message for every update
  }
};

// Debounced version for volume changes
const updatePreferences = debounce(updatePreferencesImmediate, 300);

// Handle sound type change
const handleTypeChange = async (eventType: keyof typeof eventTypes) => {
  const newType = soundPreferences.value.eventSounds[eventType].type;
  
  if (newType === 'custom') {
    // Check if we already have a custom path
    const currentPath = soundPreferences.value.eventSounds[eventType].path;
    if (!currentPath || currentPath.startsWith('kill-event')) {
      // Set a placeholder path so the button shows
      soundPreferences.value.eventSounds[eventType].path = '';
    }
    // Just update preferences to save the type change
    updatePreferencesImmediate();
  } else if (newType === 'default') {
    // Reset to default sound when switching back
    const defaultPath = getDefaultPathForEventType(eventType);
    soundPreferences.value.eventSounds[eventType].path = defaultPath;
    updatePreferencesImmediate();
  } else if (newType === 'none') {
    // Just update when setting to none
    updatePreferencesImmediate();
  }
};

// Helper to get default path for event type
const getDefaultPathForEventType = (eventType: keyof typeof eventTypes): string => {
  const defaults = {
    vehicleDestruction: 'clean_pop',
    crash: 'metallic_din_2',
    playerKill: 'metallic_din_1',
    npcKill: 'metallic_din_npc',
    playerDeath: 'cranial_snap'
  };
  return defaults[eventType] || 'metallic_din_1';
};


// Select custom sound file (with error messages for button click)
const selectCustomSound = async (eventType: keyof typeof eventTypes) => {
  try {
    if (!window.logMonitorApi?.selectSoundFile) {
      console.error('selectSoundFile API not available');
      return;
    }
    
    console.log('Opening file selector...');
    const filePath = await window.logMonitorApi.selectSoundFile();
    console.log('File selected:', filePath);
    
    if (filePath) {
      soundPreferences.value.eventSounds[eventType].path = filePath;
      soundPreferences.value.eventSounds[eventType].type = 'custom';
      
      try {
        await updatePreferencesImmediate();
        ElMessage.success('Custom sound selected');
      } catch (saveError) {
        console.error('Failed to save preferences:', saveError);
        // Still keep the selection even if save failed
      }
    } else {
      console.log('File selection cancelled');
      // User cancelled - check if they have no valid custom path
      if (!soundPreferences.value.eventSounds[eventType].path || 
          soundPreferences.value.eventSounds[eventType].path === '' ||
          soundPreferences.value.eventSounds[eventType].path.startsWith('kill-event')) {
        // Revert to default since they don't have a custom sound selected
        soundPreferences.value.eventSounds[eventType].type = 'default';
        const defaultPath = getDefaultPathForEventType(eventType);
        soundPreferences.value.eventSounds[eventType].path = defaultPath;
        updatePreferencesImmediate();
      }
    }
  } catch (error) {
    console.error('Failed to select sound file:', error);
    ElMessage.error('Failed to select sound file');
    // Revert on error
    soundPreferences.value.eventSounds[eventType].type = 'default';
    const defaultPath = getDefaultPathForEventType(eventType);
    soundPreferences.value.eventSounds[eventType].path = defaultPath;
    updatePreferencesImmediate();
  }
};

// Test sound playback
const testSound = async (eventType: keyof typeof eventTypes) => {
  const config = soundPreferences.value.eventSounds[eventType];
  if (config.type === 'none') return;
  
  try {
    let audio: HTMLAudioElement;
    
    if (config.type === 'custom' && config.path) {
      // For custom sounds, load through IPC to get data URL
      const result = await window.logMonitorApi.testSound(config.path, config.volume);
      
      if (!result.success) {
        ElMessage.error(result.error || 'Failed to load sound file');
        return;
      }
      
      if (result.dataUrl) {
        // Use the data URL returned from IPC
        audio = new Audio(result.dataUrl);
        audio.volume = config.volume || 0.5;
      } else {
        ElMessage.error('Failed to load sound file');
        return;
      }
    } else {
      // For default sounds, try multiple formats
      const formats = ['mp3', 'm4a', 'wav'];
      let audioCreated = false;
      
      for (const format of formats) {
        try {
          const soundPath = config.path;
          const soundUrl = new URL(`/sounds/${soundPath}.${format}`, window.location.href).href;
          audio = new Audio(soundUrl);
          audio.volume = config.volume || 0.5;
          
          // Test if the file exists
          await new Promise((resolve, reject) => {
            audio.addEventListener('canplaythrough', resolve, { once: true });
            audio.addEventListener('error', reject, { once: true });
            audio.load();
          });
          
          audioCreated = true;
          break;
        } catch (e) {
          // Continue to next format
        }
      }
      
      if (!audioCreated) {
        ElMessage.error('Failed to play sound - file may be missing');
        return;
      }
    }
    
    await audio.play();
    ElMessage.success(`Testing ${eventTypes[eventType].label} sound`);
  } catch (error) {
    console.error('Failed to play test sound:', error);
    ElMessage.error('Failed to play sound');
  }
};

// Get filename from path
const getFileName = (path: string): string => {
  if (!path || path === 'kill-event') return '';
  return path.split(/[/\\]/).pop() || path;
};

// Get truncated filename for display
const getTruncatedFileName = (path: string): string => {
  const fileName = getFileName(path);
  if (!fileName) return '';
  
  // Truncate to 16 characters total (including extension)
  if (fileName.length > 16) {
    return fileName.slice(0, 13) + '...';
  }
  
  return fileName;
};
</script>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Test sound button - dark theme styling */
.test-sound-btn {
  background-color: rgba(99, 99, 247, 0.1) !important;
  border-color: rgba(99, 99, 247, 0.3) !important;
  color: white !important;
}

.test-sound-btn .play-icon {
  color: rgba(255, 255, 255, 0.7) !important;
  font-size: 14px;
}

.test-sound-btn:hover:not(:disabled) {
  background-color: rgba(99, 99, 247, 0.2) !important;
  border-color: rgb(99, 99, 247) !important;
  color: white !important;
}

.test-sound-btn:hover:not(:disabled) .play-icon {
  color: rgba(255, 255, 255, 0.9) !important;
}

.test-sound-btn:active:not(:disabled) {
  background-color: rgba(99, 99, 247, 0.3) !important;
}

.test-sound-btn:disabled {
  opacity: 0.3;
  background-color: transparent !important;
  border-color: #6b7280 !important;
  color: #6b7280 !important;
}

.test-sound-btn:disabled .play-icon {
  color: #6b7280 !important;
}

/* Custom Element Plus overrides for dark theme */
:deep(.el-select) {
  --el-select-input-focus-border-color: var(--color-theme-primary);
}

:deep(.sound-select .el-input__inner) {
  background-color: var(--color-theme-bg-secondary);
  border-color: var(--color-theme-border);
  color: var(--color-theme-text-white);
}

:deep(.sound-select .el-input__inner:hover) {
  border-color: var(--color-theme-primary);
}

:deep(.el-select-dropdown) {
  background-color: var(--color-theme-bg-secondary);
  border-color: var(--color-theme-border);
}

:deep(.el-select-dropdown__item) {
  color: var(--color-theme-text-light);
}

:deep(.el-select-dropdown__item:hover) {
  background-color: var(--color-theme-bg-panel);
  color: var(--color-theme-text-white);
}

:deep(.el-select-dropdown__item.selected) {
  color: var(--color-theme-primary);
}

:deep(.el-slider__runway) {
  background-color: rgba(99, 99, 247, 0.2) !important;
  height: 6px;
}

:deep(.el-slider__bar) {
  background-color: rgb(99, 99, 247) !important;
  height: 6px;
}

:deep(.el-slider__button-wrapper) {
  top: -15px;
}

:deep(.el-slider__button) {
  border: 2px solid rgb(99, 99, 247) !important;
  background-color: #1f2937 !important;
  width: 16px;
  height: 16px;
}

/* Style for disabled state */
:deep(.el-slider.is-disabled .el-slider__runway) {
  background-color: #374151 !important;
  opacity: 0.5;
}

:deep(.el-slider.is-disabled .el-slider__bar) {
  background-color: #6b7280 !important;
}

:deep(.el-slider.is-disabled .el-slider__button) {
  border-color: #6b7280 !important;
  background-color: #374151 !important;
}

:deep(.el-button.is-plain) {
  background-color: var(--color-theme-bg-secondary);
  border-color: var(--color-theme-border);
  color: var(--color-theme-text-light);
}

:deep(.el-button.is-plain:hover) {
  background-color: var(--color-theme-bg-panel);
  border-color: var(--color-theme-primary);
  color: var(--color-theme-text-white);
}

/* Custom file button styling */
.custom-file-button {
  width: 140px !important;
  min-width: 140px !important;
  display: inline-flex !important;
  align-items: center;
  overflow: hidden;
}

.file-name {
  display: inline-block;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>