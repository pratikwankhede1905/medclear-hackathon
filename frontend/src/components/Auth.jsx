import { useState } from "react";
import { Auth } from "aws-amplify";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, UserPlus, Eye, EyeOff, ShieldCheck } from "lucide-react";
import AnimatedWrapper from "./AnimatedWrapper";

const TABS = [
  { key: "login", label: "Log In", icon: LogIn },
  { key: "signup", label: "Sign Up", icon: UserPlus },
];

export default function AuthScreen({ onSignIn }) {
  const [activeTab, setActiveTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  function resetForm() {
    setEmail("");
    setPassword("");
    setConfirmCode("");
    setError("");
    setShowPassword(false);
    setNeedsConfirmation(false);
  }

  function switchTab(tab) {
    resetForm();
    setActiveTab(tab);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await Auth.signIn(email.trim(), password);
      onSignIn(user);
    } catch (err) {
      if (err.code === "UserNotConfirmedException") {
        setNeedsConfirmation(true);
        setError("Please confirm your account with the code sent to your email.");
      } else if (err.code === "NotAuthorizedException") {
        setError("Incorrect email or password. Please try again.");
      } else if (err.code === "UserNotFoundException") {
        setError("No account found with this email. Please sign up first.");
      } else {
        setError(err.message || "Unable to sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);

    try {
      await Auth.signUp({
        username: email.trim(),
        password,
        attributes: { email: email.trim() },
      });
      setNeedsConfirmation(true);
      setError("");
    } catch (err) {
      if (err.code === "UsernameExistsException") {
        setError("An account with this email already exists. Try logging in.");
      } else if (err.code === "InvalidPasswordException") {
        setError(
          "Password does not meet requirements. Use at least 8 characters with a mix of letters and numbers."
        );
      } else {
        setError(err.message || "Unable to create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await Auth.confirmSignUp(email.trim(), confirmCode.trim());
      // Auto sign-in after confirmation
      const user = await Auth.signIn(email.trim(), password);
      onSignIn(user);
    } catch (err) {
      if (err.code === "CodeMismatchException") {
        setError("Invalid confirmation code. Please check and try again.");
      } else if (err.code === "ExpiredCodeException") {
        setError("This code has expired. Please request a new one.");
      } else {
        setError(err.message || "Confirmation failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <AnimatedWrapper className="w-full max-w-md">
        <div className="glass-card p-8">
          {/* Logo / Header */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-teal-500 shadow-lg">
              <ShieldCheck className="h-8 w-8 text-white" strokeWidth={2} />
            </div>
            <h1 className="text-3xl font-bold text-slate-700">MedClear</h1>
            <p className="mt-2 text-lg text-slate-500">
              Understand your medical reports clearly
            </p>
          </div>

          {/* Tabs */}
          {!needsConfirmation && (
            <div className="mb-6 flex rounded-xl bg-slate-100 p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg py-3 text-lg font-medium transition-colors ${
                    activeTab === tab.key
                      ? "text-white"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {activeTab === tab.key && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 rounded-lg bg-gradient-to-r from-teal-600 to-teal-500"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <tab.icon className="h-5 w-5" />
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Error Message */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-base text-red-700"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Confirmation Form */}
          {needsConfirmation ? (
            <motion.form
              key="confirm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onSubmit={handleConfirm}
              className="space-y-4"
            >
              <p className="text-base text-slate-600">
                We sent a confirmation code to <strong>{email}</strong>.
                Enter it below to verify your account.
              </p>

              <div>
                <label
                  htmlFor="confirmCode"
                  className="mb-1 block text-base font-medium text-slate-600"
                >
                  Confirmation Code
                </label>
                <input
                  id="confirmCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  className="input-field text-center text-2xl tracking-widest"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading || !confirmCode.trim()}
                className="btn-primary w-full"
              >
                {loading ? "Verifying..." : "Verify Account"}
              </button>

              <button
                type="button"
                onClick={() => setNeedsConfirmation(false)}
                className="w-full text-center text-base text-teal-600 hover:underline"
              >
                Go back
              </button>
            </motion.form>
          ) : (
            <AnimatePresence mode="wait">
              {/* Login Form */}
              {activeTab === "login" && (
                <motion.form
                  key="login"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25 }}
                  onSubmit={handleLogin}
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor="loginEmail"
                      className="mb-1 block text-base font-medium text-slate-600"
                    >
                      Email Address
                    </label>
                    <input
                      id="loginEmail"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="input-field"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="loginPassword"
                      className="mb-1 block text-base font-medium text-slate-600"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="loginPassword"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="input-field pr-12"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5" />
                        ) : (
                          <Eye className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !email.trim() || !password}
                    className="btn-primary w-full"
                  >
                    {loading ? "Signing in..." : "Sign In"}
                  </button>
                </motion.form>
              )}

              {/* Signup Form */}
              {activeTab === "signup" && (
                <motion.form
                  key="signup"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  onSubmit={handleSignup}
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor="signupEmail"
                      className="mb-1 block text-base font-medium text-slate-600"
                    >
                      Email Address
                    </label>
                    <input
                      id="signupEmail"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="input-field"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="signupPassword"
                      className="mb-1 block text-base font-medium text-slate-600"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="signupPassword"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="input-field pr-12"
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5" />
                        ) : (
                          <Eye className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      Use at least 8 characters with letters and numbers
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !email.trim() || password.length < 8}
                    className="btn-primary w-full"
                  >
                    {loading ? "Creating account..." : "Create Account"}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          )}
        </div>
      </AnimatedWrapper>
    </div>
  );
}
