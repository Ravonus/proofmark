"use client";

import {
  ArrowLeft,
  Eye,
  EyeOff,
  Maximize2,
  Menu,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  Save,
  Send,
  Undo2,
  Users,
} from "lucide-react";
import { W3SButton, W3SIconButton } from "../ui/motion";

type ToolbarProps = {
  title: string;
  onTitleChange: (v: string) => void;
  fieldCount: number;
  signerCount: number;
  showPanel: boolean;
  showSigners: boolean;
  previewMode: boolean;
  fullscreen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  collabSessionId: string | null;
  collabSession: unknown;
  mobilePanel: boolean;
  onBack: () => void;
  togglePanel: () => void;
  setMobilePanel: (v: boolean) => void;
  setShowAddSection: (v: boolean) => void;
  setShowSigners: (v: boolean) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  setPreviewMode: (v: boolean) => void;
  setFullscreen: (v: boolean) => void;
  onSaveTemplate?: () => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  CollabSharePopover: React.ComponentType<{
    sessionId: string;
    joinToken: string;
  }>;
};

export function EditorToolbar({
  title,
  onTitleChange,
  fieldCount,
  signerCount,
  showPanel,
  showSigners,
  previewMode,
  fullscreen,
  canUndo,
  canRedo,
  collabSessionId,
  collabSession,
  mobilePanel,
  onBack,
  togglePanel,
  setMobilePanel,
  setShowAddSection,
  setShowSigners,
  handleUndo,
  handleRedo,
  setPreviewMode,
  setFullscreen,
  onSaveTemplate,
  onSubmit,
  submitDisabled,
  CollabSharePopover,
}: ToolbarProps) {
  const cs = collabSession as {
    session?: { joinToken?: string };
  } | null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 sm:gap-2 sm:px-4">
      <W3SIconButton onClick={onBack} title="Back">
        <ArrowLeft className="h-4 w-4" />
      </W3SIconButton>

      <div className="hidden h-5 w-px bg-[var(--border)] sm:block" />

      <W3SIconButton onClick={togglePanel} active={showPanel} className="hidden sm:inline-flex" title="Fields panel">
        {showPanel ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
      </W3SIconButton>

      <W3SIconButton onClick={() => setMobilePanel(!mobilePanel)} className="sm:hidden" title="Fields">
        <Menu className="h-4 w-4" />
      </W3SIconButton>

      <W3SButton variant="ghost" size="xs" onClick={() => setShowAddSection(true)}>
        <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Section</span>
      </W3SButton>

      <div className="min-w-0 flex-1">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled Document"
          className="w-full max-w-xs truncate bg-transparent text-sm font-semibold outline-none placeholder:text-muted"
        />
      </div>

      <span className="hidden text-[10px] text-muted sm:inline">{fieldCount} fields</span>

      <W3SButton
        variant={showSigners ? "accent-outline" : "ghost"}
        size="xs"
        onClick={() => setShowSigners(!showSigners)}
      >
        <Users className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Signers</span>
        <span className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px]">{signerCount}</span>
      </W3SButton>

      <div className="h-5 w-px bg-[var(--border)]" />

      <W3SIconButton onClick={handleUndo} disabled={!canUndo} title="Undo (Cmd+Z)">
        <Undo2 className="h-3.5 w-3.5" />
      </W3SIconButton>
      <W3SIconButton onClick={handleRedo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
        <Redo2 className="h-3.5 w-3.5" />
      </W3SIconButton>

      <div className="h-5 w-px bg-[var(--border)]" />

      <W3SButton variant={previewMode ? "primary" : "ghost"} size="xs" onClick={() => setPreviewMode(!previewMode)}>
        {previewMode ? (
          <>
            <EyeOff className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
          </>
        ) : (
          <>
            <Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Preview</span>
          </>
        )}
      </W3SButton>

      <W3SIconButton
        onClick={() => setFullscreen(!fullscreen)}
        className="hidden sm:inline-flex"
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </W3SIconButton>

      {onSaveTemplate && (
        <W3SIconButton onClick={onSaveTemplate} className="hidden sm:inline-flex" title="Save template">
          <Save className="h-3.5 w-3.5" />
        </W3SIconButton>
      )}

      {collabSessionId && cs && (
        <CollabSharePopover sessionId={collabSessionId} joinToken={cs.session?.joinToken ?? ""} />
      )}

      <W3SButton variant="primary" size="xs" onClick={onSubmit} disabled={submitDisabled}>
        <Send className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Send</span>
      </W3SButton>
    </div>
  );
}
