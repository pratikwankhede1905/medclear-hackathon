import { useState, useEffect } from "react";
import { Auth } from "aws-amplify";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, ShieldCheck } from "lucide-react";
import AuthScreen from "./components/Auth";
import UploadForm from "./components/UploadForm";
import Summary from "./components/Summary";
import AnimatedWrapper from "./components/AnimatedWrapper";

/**
 * App-level view states:
 *  - "upload"  : show the upload form
 *  - "result"  : show the summary results
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [view, setView] = useState("upload");
  const [resultData, setResultData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Check if already signed in on mount
  useEffect(() => {
    Auth.currentAuthenticatedUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  async function handleSignOut() {
    try {
      await Auth.signOut();
      setUser(null);
      setView("upload");
      setResultData(null);
      setErrorMessage("");
    } catch (err) {
      console.error("Sign out error:", err);
    }
  }

  function handleResult(data) {
    setResultData(data);
    setErrorMessage("");
    setView("result");
  }

  function handleError(msg) {
    setErrorMessage(msg);
    setResultData(null);
    setView("result");
  }

  function handleReset() {
    setView("upload");
    setResultData(null);
    setErrorMessage("");
  }

  // Loading state while checking auth
  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <motion.div
          className="h-12 w-12 rounded-full border-4 border-teal-200 border-t-teal-600"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  // Not signed in -- show auth screen
  if (!user) {
    return <AuthScreen onSignIn={(u) => setUser(u)} />;
  }

  // Signed in -- main app layout
  return (
    <div className="min-h-screen">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-white/30 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-teal-500 shadow-md">
              <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-xl font-bold text-slate-700">MedClear</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-base text-slate-500 sm:block">
              {user.attributes?.email || user.username || ""}
            </span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-base font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-4 py-8">
        <AnimatePresence mode="wait">
          {view === "upload" && (
            <AnimatedWrapper key="upload">
              <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold text-slate-700 sm:text-4xl">
                  Understand Your Medical Reports
                </h1>
                <p className="mt-3 text-lg text-slate-500">
                  Upload a report and get a clear, easy-to-read explanation
                </p>
              </div>
              <UploadForm onResult={handleResult} onError={handleError} />
            </AnimatedWrapper>
          )}

          {view === "result" && (
            <AnimatedWrapper key="result">
              <Summary
                data={resultData}
                error={errorMessage}
                onRetry={handleReset}
                onReset={handleReset}
              />
            </AnimatedWrapper>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white/50 py-6 text-center">
        <p className="text-base text-slate-400">
          MedClear is not a substitute for professional medical advice.
          Always consult your healthcare provider.
        </p>
      </footer>
    </div>
  );
}
