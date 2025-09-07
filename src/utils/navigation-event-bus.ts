import type { NavigationSection } from '../composables/useNavigationState';

export interface NavigationEvent {
  type: 'navigate' | 'state-change' | 'window-closed';
  section?: NavigationSection | null;
  isOpen?: boolean;
  source?: string;
}

class NavigationEventBus {
  private listeners: Map<string, Set<(event: NavigationEvent) => void>> = new Map();
  private currentSection: NavigationSection | null = null;
  private isWindowOpen: boolean = false;
  
  constructor() {
    // Ensure singleton
    if ((window as any).__navigationEventBus) {
      return (window as any).__navigationEventBus;
    }
    
    (window as any).__navigationEventBus = this;
    this.setupDebugHelpers();
  }
  
  emit(event: NavigationEvent): void {
    console.log('[NavigationEventBus] Emitting event:', event);
    
    // Update internal state
    if (event.type === 'state-change' || event.type === 'navigate') {
      if (event.section !== undefined) {
        this.currentSection = event.section;
      }
      if (event.isOpen !== undefined) {
        this.isWindowOpen = event.isOpen;
      }
    } else if (event.type === 'window-closed') {
      this.isWindowOpen = false;
      this.currentSection = null;
    }
    
    // Notify all listeners
    const listeners = this.listeners.get(event.type) || new Set();
    listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[NavigationEventBus] Error in listener:', error);
      }
    });
    
    // Also notify 'all' listeners
    const allListeners = this.listeners.get('all') || new Set();
    allListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[NavigationEventBus] Error in all listener:', error);
      }
    });
  }
  
  on(type: string, listener: (event: NavigationEvent) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    
    this.listeners.get(type)!.add(listener);
    
    // Return cleanup function
    return () => {
      const listeners = this.listeners.get(type);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }
  
  getState(): { currentSection: NavigationSection | null; isWindowOpen: boolean } {
    return {
      currentSection: this.currentSection,
      isWindowOpen: this.isWindowOpen
    };
  }
  
  private setupDebugHelpers(): void {
    (window as any).__navBusDebug = {
      getState: () => this.getState(),
      getListeners: () => {
        const result: Record<string, number> = {};
        this.listeners.forEach((listeners, type) => {
          result[type] = listeners.size;
        });
        return result;
      },
      emit: (event: NavigationEvent) => this.emit(event)
    };
  }
}

// Create and export singleton instance
export const navigationEventBus = new NavigationEventBus();