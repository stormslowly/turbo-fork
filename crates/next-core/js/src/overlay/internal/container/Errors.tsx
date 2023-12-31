import * as React from "react";

import { Issue } from "@vercel/turbopack-runtime/types/protocol";

import {
  TYPE_UNHANDLED_ERROR,
  TYPE_UNHANDLED_REJECTION,
  UnhandledError,
  UnhandledRejection,
} from "../bus";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogHeaderTabList,
  DialogProps,
} from "../components/Dialog";
import { Overlay } from "../components/Overlay";
import { Tab, TabPanel, Tabs } from "../components/Tabs";
import { getErrorByType, ReadyRuntimeError } from "../helpers/getErrorByType";
import { getErrorSource } from "../helpers/nodeStackFrames";
import { noop as css } from "../helpers/noop-template";
import { AlertOctagon, PackageX } from "../icons";
import { RuntimeErrorsDialogBody } from "./RuntimeError";
import { TurbopackIssuesDialogBody } from "../container/TurbopackIssue";
import { ErrorsToast } from "../container/ErrorsToast";

export type SupportedErrorEvent = {
  id: number;
  event: UnhandledError | UnhandledRejection;
};
export type ErrorsProps = {
  issues: Issue[];
  errors: SupportedErrorEvent[];
};

type ReadyErrorEvent = ReadyRuntimeError;

function getErrorSignature(ev: SupportedErrorEvent): string {
  const { event } = ev;
  switch (event.type) {
    case TYPE_UNHANDLED_ERROR:
    case TYPE_UNHANDLED_REJECTION: {
      return `${event.reason.name}::${event.reason.message}::${event.reason.stack}`;
    }
    default: {
      return "";
    }
  }
}

function useResolvedErrors(
  errors: SupportedErrorEvent[]
): [ReadyRuntimeError[], boolean] {
  const [lookups, setLookups] = React.useState(
    {} as { [eventId: string]: ReadyErrorEvent }
  );

  const [readyErrors, nextError] = React.useMemo<
    [ReadyErrorEvent[], SupportedErrorEvent | null]
  >(() => {
    const ready: ReadyErrorEvent[] = [];
    let next: SupportedErrorEvent | null = null;

    // Ensure errors are displayed in the order they occurred in:
    for (let idx = 0; idx < errors.length; ++idx) {
      const e = errors[idx];
      const { id } = e;
      if (id in lookups) {
        ready.push(lookups[id]);
        continue;
      }

      // Check for duplicate errors
      if (idx > 0) {
        const prev = errors[idx - 1];
        if (getErrorSignature(prev) === getErrorSignature(e)) {
          continue;
        }
      }

      next = e;
      break;
    }

    return [ready, next];
  }, [errors, lookups]);

  const isLoading = readyErrors.length === 0 && errors.length > 1;

  React.useEffect(() => {
    if (nextError == null) {
      return;
    }
    let mounted = true;

    getErrorByType(nextError).then(
      (resolved) => {
        // We don't care if the desired error changed while we were resolving,
        // thus we're not tracking it using a ref. Once the work has been done,
        // we'll store it.
        if (mounted) {
          setLookups((m) => ({ ...m, [resolved.id]: resolved }));
        }
      },
      () => {
        // TODO: handle this, though an edge case
      }
    );

    return () => {
      mounted = false;
    };
  }, [nextError]);

  // Reset component state when there are no errors to be displayed.
  // This should never happen, but let's handle it.
  React.useEffect(() => {
    if (errors.length === 0) {
      setLookups({});
    }
  }, [errors.length]);

  return [readyErrors, isLoading];
}

const enum DisplayState {
  Fullscreen,
  Minimized,
  Hidden,
}

type DisplayStateAction = (e?: MouseEvent | TouchEvent) => void;

type DisplayStateActions = {
  fullscreen: DisplayStateAction;
  minimize: DisplayStateAction;
  hide: DisplayStateAction;
};

function useDisplayState(
  initialState: DisplayState
): [DisplayState, DisplayStateActions] {
  const [displayState, setDisplayState] =
    React.useState<DisplayState>(initialState);

  const actions = React.useMemo<DisplayStateActions>(
    () => ({
      fullscreen: (e) => {
        e?.preventDefault();
        setDisplayState(DisplayState.Fullscreen);
      },
      minimize: (e) => {
        e?.preventDefault();
        setDisplayState(DisplayState.Minimized);
      },
      hide: (e) => {
        e?.preventDefault();
        setDisplayState(DisplayState.Hidden);
      },
    }),
    []
  );

  return [displayState, actions];
}

const enum TabId {
  TurbopackErrors = "turbopack-issues",
  TurbopackWarnings = "turbopack-warnings",
  RuntimeErrors = "runtime-errors",
}

const TAB_PRIORITY = [
  TabId.TurbopackErrors,
  TabId.RuntimeErrors,
  TabId.TurbopackWarnings,
];

export function Errors({ issues, errors }: ErrorsProps) {
  const [readyErrors, isLoading] = useResolvedErrors(errors);

  const turbopackWarnings = issues.filter(
    (issue) => !["bug", "fatal", "error"].includes(issue.severity)
  );
  const turbopackErrors = issues.filter((issue) =>
    ["bug", "fatal", "error"].includes(issue.severity)
  );

  const hasTurbopackWarnings = turbopackWarnings.length > 0;
  const hasTurbopackErrors = turbopackErrors.length > 0;

  const hasErrors = errors.length !== 0;
  const hasServerError = readyErrors.some((err) =>
    ["server", "edge-server"].includes(getErrorSource(err.error) || "")
  );

  // TODO for now it's already closable, but in future we might want to block users from using a broken app
  // const isClosable = !isLoading && !hasTurbopackErrors && !hasServerError;
  const isClosable = true;

  const defaultTab =
    TAB_PRIORITY.find(
      (tabId) =>
        ({
          [TabId.TurbopackErrors]: turbopackErrors.length > 0,
          [TabId.TurbopackWarnings]: turbopackWarnings.length > 0,
          [TabId.RuntimeErrors]: hasErrors,
        }[tabId])
    ) ?? TabId.RuntimeErrors;

  const [selectedTab, setSelectedTab] = React.useState<string>(defaultTab);

  React.useEffect(() => {
    if (defaultTab === TabId.TurbopackErrors) {
      setSelectedTab(TabId.TurbopackErrors);
    }
  }, [defaultTab]);

  const onlyHasWarnings = !hasErrors && !hasTurbopackErrors;

  const [stateDisplayState, { fullscreen, minimize, hide }] = useDisplayState(
    onlyHasWarnings ? DisplayState.Minimized : DisplayState.Fullscreen
  );
  let displayState = stateDisplayState;

  if (!isClosable) {
    displayState = DisplayState.Fullscreen;
  }

  // This component shouldn't be rendered with no errors, but if it is, let's
  // handle it gracefully by rendering nothing.
  if (!hasErrors && !hasTurbopackWarnings && !hasTurbopackErrors) {
    return null;
  }

  if (displayState === DisplayState.Hidden) {
    return null;
  }

  if (displayState === DisplayState.Minimized) {
    return (
      <ErrorsToast
        errorCount={readyErrors.length + turbopackErrors.length}
        warningCount={turbopackWarnings.length}
        severity={onlyHasWarnings ? "warning" : "error"}
        onClick={fullscreen}
        onClose={hide}
      />
    );
  }

  return (
    <ErrorsDialog
      aria-labelledby="nextjs__container_errors_label"
      aria-describedby="nextjs__container_errors_desc"
      onClose={isClosable ? minimize : undefined}
    >
      <Tabs
        defaultId={defaultTab}
        selectedId={selectedTab}
        onChange={setSelectedTab}
      >
        <DialogHeader
          className="errors-header"
          close={isClosable ? minimize : undefined}
        >
          <DialogHeaderTabList>
            {hasTurbopackErrors && (
              <Tab
                id={TabId.TurbopackErrors}
                next={
                  hasTurbopackWarnings
                    ? TabId.TurbopackWarnings
                    : hasErrors
                    ? TabId.RuntimeErrors
                    : undefined
                }
                data-severity="error"
              >
                <PackageX />
                {turbopackErrors.length} Turbopack Error
                {turbopackErrors.length > 1 ? "s" : ""}
              </Tab>
            )}
            {hasTurbopackWarnings && (
              <Tab
                id={TabId.TurbopackWarnings}
                prev={hasTurbopackErrors ? TabId.TurbopackErrors : undefined}
                next={hasErrors ? TabId.RuntimeErrors : undefined}
                data-severity="warning"
              >
                <PackageX />
                {turbopackWarnings.length} Turbopack Warning
                {turbopackWarnings.length > 1 ? "s" : ""}
              </Tab>
            )}
            {hasErrors && (
              <Tab
                id={TabId.RuntimeErrors}
                prev={
                  hasTurbopackWarnings
                    ? TabId.TurbopackWarnings
                    : hasTurbopackErrors
                    ? TabId.TurbopackErrors
                    : undefined
                }
                data-severity="error"
              >
                <AlertOctagon />
                {isLoading
                  ? "Loading Runtime Errors ..."
                  : `${readyErrors.length} Runtime Error${
                      readyErrors.length > 1 ? "s" : ""
                    }`}
              </Tab>
            )}
          </DialogHeaderTabList>
        </DialogHeader>
        {hasTurbopackErrors && (
          <TabPanel
            as={TurbopackIssuesDialogBody}
            id={TabId.TurbopackErrors}
            issues={turbopackErrors}
            className="errors-body"
          />
        )}
        {hasTurbopackWarnings && (
          <TabPanel
            as={TurbopackIssuesDialogBody}
            id={TabId.TurbopackWarnings}
            issues={turbopackWarnings}
            className="errors-body"
          />
        )}
        {hasErrors && (
          <TabPanel
            as={RuntimeErrorsDialogBody}
            id={TabId.RuntimeErrors}
            isLoading={isLoading}
            readyErrors={readyErrors}
            className="errors-body"
          />
        )}
      </Tabs>
    </ErrorsDialog>
  );
}

function ErrorsDialog({ children, ...props }: DialogProps) {
  return (
    <Overlay>
      <Dialog {...props}>
        <DialogContent>{children}</DialogContent>
      </Dialog>
    </Overlay>
  );
}

export const styles = css`
  /** == Header == */

  .errors-header > .tab-list > .tab > svg {
    margin-right: var(--size-gap);
  }

  .errors-header > .tab-list > .tab[data-severity="error"] > svg {
    color: var(--color-error);
  }

  .errors-header > .tab-list > .tab[data-severity="warning"] > svg {
    color: var(--color-warning);
  }

  .errors-header > .tab-list > .tab {
    position: relative;
  }

  .errors-header > .tab-list > .tab[data-severity="error"]::after {
    border-top-color: var(--color-error);
  }

  .errors-header > .tab-list > .tab[data-severity="warning"]::after {
    border-top-color: var(--color-warning);
  }

  /** == Body == */

  .errors-body {
    display: flex;
    flex-direction: column;
    overflow-y: hidden;
  }

  .errors-body > .title-pagination {
    display: flex;
    justify-content: space-between;
    align-items: center;

    margin-bottom: var(--size-gap);
  }

  .errors-body > .title-pagination > nav > small {
    font-size: var(--size-font-small);
    color: var(--color-text-dim);
    margin-right: var(--size-gap);
    opacity: 0.7;
  }

  .errors-body > .title-pagination > nav > small > span {
    font-family: var(--font-mono);
  }

  .errors-body > .title-pagination > h1 {
    font-size: var(--size-font-big);
    color: var(--color-text-dim);
    margin: 0;
    opacity: 0.9;
  }

  .errors-body > h2 {
    font-family: var(--font-mono);
    font-size: var(--size-font-big);
    line-height: var(--size-font-bigger);
    font-weight: bold;
    margin: 0;
    margin-bottom: var(--size-gap);
    color: var(--color-error);
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  .errors-body > h2[data-severity="error"] {
    color: var(--color-error);
  }

  .errors-body > h2[data-severity="warning"] {
    color: var(--color-warning);
  }

  .errors-body > div > small {
    margin: 0;
    margin-top: var(--size-gap-half);
  }

  .errors-body > h2 > a {
    color: var(--color-error);
  }

  .errors-body > h5:not(:first-child) {
    margin-top: var(--size-gap-double);
  }

  .errors-body > h5 {
    margin-bottom: var(--size-gap);
  }
`;
