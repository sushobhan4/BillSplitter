import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useMorphPresence } from '../hooks/useMorphPresence';

export interface SelectOption {
  value: number | string;
  label: string;
}

interface CustomSelectProps {
  value: number | string;
  options: SelectOption[];
  placeholder?: string;
  onChange: (value: number | string) => void;
  className?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  placeholder = 'Select an option',
  onChange,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { shouldRender, isClosing } = useMorphPresence(isOpen, 150);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  const handleSelect = (optValue: number | string) => {
    onChange(optValue);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button matching Android bg_modern_input */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full h-[50px] px-3.5 pr-10 rounded-xl bg-surfaceAlt border border-cardStroke text-left text-[15px] flex items-center justify-between transition-colors focus:outline-none focus:border-textPrimary ${
          selectedOption ? 'text-textPrimary font-medium' : 'text-textHint'
        }`}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown
          className={`w-4 h-4 text-textHint absolute right-3.5 top-1/2 -translate-y-1/2 transition-transform duration-200 pointer-events-none ${
            isOpen ? 'rotate-180 text-textPrimary' : ''
          }`}
        />
      </button>

      {/* Custom Dropdown matching Android bg_spinner_popup.xml */}
      {shouldRender && (
        <div
          className={`absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[220px] overflow-y-auto rounded-[14px] bg-surface py-1.5 shadow-2xl border border-cardStroke origin-top ${
            isClosing ? 'animate-popup-morph-exit' : 'animate-popup-morph-enter'
          }`}
        >
          {placeholder && (
            <button
              type="button"
              onClick={() => handleSelect('')}
              className={`w-full text-left h-[44px] px-4 text-[14px] flex items-center justify-between transition-colors ${
                !value
                  ? 'bg-surfaceAlt text-textPrimary font-bold'
                  : 'text-textHint hover:bg-surfaceAlt/60'
              }`}
            >
              <span className="truncate">{placeholder}</span>
              {!value && <Check className="w-4 h-4 text-textPrimary shrink-0" />}
            </button>
          )}

          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left h-[44px] px-4 text-[15px] flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-surfaceAlt text-textPrimary font-bold'
                    : 'text-textPrimary hover:bg-surfaceAlt/60 font-medium'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="w-4 h-4 text-textPrimary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
