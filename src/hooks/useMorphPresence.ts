import { useState, useEffect } from 'react';

/**
 * Hook to manage smooth enter and exit morph animations for dialogs and popups.
 * Keeps the component mounted while the exit morph animation plays.
 */
export function useMorphPresence(isOpen: boolean, exitDuration = 180) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = window.setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, exitDuration);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, exitDuration, shouldRender]);

  return { shouldRender, isClosing };
}
