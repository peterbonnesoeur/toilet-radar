// UI Layout Manager for map controls positioning
export type ScreenSize = 'mobile' | 'tablet' | 'desktop';
export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface ControlConfig {
  id: string;
  position: ControlPosition;
  priority: number; // Higher priority = closer to corner
  mobilePosition?: ControlPosition;
  spacing?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

export interface LayoutResult {
  position: ControlPosition;
  style: React.CSSProperties;
  zIndex: number;
}

export class UILayoutManager {
  private static controls: Map<string, ControlConfig> = new Map();
  private static readonly BASE_Z_INDEX = 1000;
  private static readonly CONTROL_SPACING = 10;
  // 44px minimum touch target (Apple HIG / WCAG); a little more on mobile.
  private static readonly CONTROL_SIZE = 44;
  // Keeps bottom-anchored controls clear of the Leaflet attribution bar.
  private static readonly ATTRIBUTION_CLEARANCE = 24;

  static registerControl(config: ControlConfig): void {
    this.controls.set(config.id, config);
  }

  static unregisterControl(id: string): void {
    this.controls.delete(id);
  }

  static getScreenSize(): ScreenSize {
    if (typeof window === 'undefined') return 'desktop';

    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }

  static getControlLayout(controlId: string): LayoutResult {
    const control = this.controls.get(controlId);
    if (!control) {
      return {
        position: 'top-right',
        style: { top: '10px', right: '10px' },
        zIndex: this.BASE_Z_INDEX
      };
    }

    const screenSize = this.getScreenSize();
    const isMobile = screenSize === 'mobile';

    const position = isMobile && control.mobilePosition ? control.mobilePosition : control.position;

    const sameCornerControls = Array.from(this.controls.values())
      .filter(c => {
        const cPos = isMobile && c.mobilePosition ? c.mobilePosition : c.position;
        return cPos === position && c.id !== controlId;
      })
      .sort((a, b) => b.priority - a.priority);

    const controlIndex = sameCornerControls.findIndex(c => c.priority < control.priority);
    const offset = controlIndex >= 0 ? controlIndex : sameCornerControls.length;

    return {
      position,
      style: this.calculateStyle(position, offset, control.spacing),
      zIndex: this.BASE_Z_INDEX + control.priority
    };
  }

  private static calculateStyle(
    position: ControlPosition,
    offset: number,
    spacing?: ControlConfig['spacing']
  ): React.CSSProperties {
    const baseSpacing = this.CONTROL_SPACING;
    const offsetDistance = offset * (this.CONTROL_SIZE + baseSpacing);

    const defaultSpacing = {
      top: baseSpacing,
      right: baseSpacing,
      bottom: baseSpacing + this.ATTRIBUTION_CLEARANCE,
      left: baseSpacing
    };

    const finalSpacing = { ...defaultSpacing, ...spacing };

    switch (position) {
      case 'top-left':
        return {
          position: 'absolute',
          top: `${finalSpacing.top + offsetDistance}px`,
          left: `${finalSpacing.left}px`
        };

      case 'top-right':
        return {
          position: 'absolute',
          top: `${finalSpacing.top + offsetDistance}px`,
          right: `${finalSpacing.right}px`
        };

      case 'bottom-left':
        return {
          position: 'absolute',
          bottom: `${finalSpacing.bottom + offsetDistance}px`,
          left: `${finalSpacing.left}px`
        };

      case 'bottom-right':
        return {
          position: 'absolute',
          bottom: `${finalSpacing.bottom + offsetDistance}px`,
          right: `${finalSpacing.right}px`
        };

      case 'center':
        return {
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)'
        };

      default:
        return {
          position: 'absolute',
          top: `${finalSpacing.top}px`,
          right: `${finalSpacing.right}px`
        };
    }
  }
}
