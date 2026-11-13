import React from 'react';

interface MaterialSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export const MaterialSwitch: React.FC<MaterialSwitchProps> = ({
  checked,
  onChange,
  id,
  disabled = false,
  'aria-label': ariaLabel = 'Toggle switch',
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      id={id}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] focus:outline-none ${
        checked
          ? 'bg-[#18181B] border-[#18181B] dark:bg-[#F3F4F6] dark:border-[#F3F4F6]'
          : 'bg-[#E4E7EC] border-[#D1D5DB] dark:bg-[#1A2230] dark:border-[#263042]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full shadow-sm transform transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          checked
            ? 'translate-x-5 bg-[#FFFFFF] dark:bg-[#111827]'
            : 'translate-x-0.5 bg-[#9CA3AF] dark:bg-[#6B7280]'
        }`}
      />
    </button>
  );
};
