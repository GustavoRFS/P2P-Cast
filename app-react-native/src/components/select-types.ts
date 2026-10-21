export type SelectOption<T extends string> = {
    value: T;
    label: string;
    disabled?: boolean;
};

export type SelectProps<T extends string> = {
    label: string;
    value: T;
    options: SelectOption<T>[];
    onChange: (value: T) => void;
    disabled?: boolean;
    className?: string;
};
