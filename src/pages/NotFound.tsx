import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useLang, type Lang } from "@/lib/i18n";

const T: Record<Lang, Record<string, string>> = {
  en: {
    notFound: "Oops! Page not found",
    returnHome: "Return to Home",
  },
  fr: {
    notFound: "Oups ! Page introuvable",
    returnHome: "Retour à l’accueil",
  },
};

const NotFound = () => {
  const t = T[useLang()];
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t.notFound}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          {t.returnHome}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
