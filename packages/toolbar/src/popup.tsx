import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type ToolbarPopupProps = {
  element: string;
  selectedText?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
  style?: CSSProperties;
  accentColor?: string;
};

export type ToolbarPopupHandle = {
  shake: () => void;
};

export const ToolbarPopup = forwardRef<ToolbarPopupHandle, ToolbarPopupProps>(
  function ToolbarPopup(
    {
      element,
      selectedText,
      placeholder = "What should change?",
      initialValue = "",
      submitLabel = "Add",
      onSubmit,
      onCancel,
      onDelete,
      style,
      accentColor = "#2f7bf6",
    },
    ref,
  ) {
    const [text, setText] = useState(initialValue);
    const [isFocused, setIsFocused] = useState(false);
    const [isShaking, setIsShaking] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
      setText(initialValue);
    }, [initialValue]);

    useEffect(() => {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 40);
      return () => clearTimeout(timer);
    }, []);

    const shake = useCallback(() => {
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 250);
      return () => clearTimeout(timer);
    }, []);

    useImperativeHandle(ref, () => ({ shake }), [shake]);

    const submit = useCallback(() => {
      const value = text.trim();
      if (!value) return;
      onSubmit(value);
    }, [text, onSubmit]);

    const cancel = useCallback(() => {
      onCancel();
    }, [onCancel]);

    return (
      <div
        data-ekairos-toolbar-popup
        onClick={(event) => event.stopPropagation()}
        style={{
          position: "fixed",
          width: 300,
          borderRadius: 12,
          border: `1px solid ${isShaking ? "#f14668" : "rgba(255,255,255,0.08)"}`,
          background: "#16161b",
          color: "#f5f7fa",
          padding: 12,
          zIndex: 100003,
          boxShadow: "0 10px 35px rgba(0,0,0,0.45)",
          ...style,
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.65)",
            marginBottom: 8,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {element}
        </div>

        {selectedText ? (
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.65)",
              background: "rgba(255,255,255,0.05)",
              borderRadius: 8,
              padding: "6px 8px",
              marginBottom: 8,
            }}
          >
            "{selectedText.slice(0, 100)}
            {selectedText.length > 100 ? "..." : ""}"
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={text}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          style={{
            width: "100%",
            resize: "none",
            borderRadius: 8,
            border: `1px solid ${isFocused ? accentColor : "rgba(255,255,255,0.15)"}`,
            background: "rgba(255,255,255,0.04)",
            color: "#f5f7fa",
            fontSize: 13,
            lineHeight: 1.4,
            padding: "8px 10px",
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
          }}
        >
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              style={{
                marginRight: "auto",
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                padding: "4px 6px",
              }}
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={cancel}
            style={{
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.72)",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            style={{
              border: "none",
              borderRadius: 999,
              background: accentColor,
              color: "#fff",
              cursor: text.trim() ? "pointer" : "not-allowed",
              opacity: text.trim() ? 1 : 0.45,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    );
  },
);

