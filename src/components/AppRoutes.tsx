import { HashRouter as Router, Route, Routes } from "react-router-dom";
import ProjectSelectHomePage from "@/pages/ProjectSelectHomePage";
import EditorPage from "@/pages/EditorPage";
import NotFoundPage from "@/pages/NotFoundPage";

const AppRoutes = () => {
  return (
    <Router>
      <Routes>
        <Route path="*" element={<NotFoundPage />} />
        <Route path="/" element={<ProjectSelectHomePage />} />
        <Route path="/edit/:projectId" element={<EditorPage />} />
      </Routes>
    </Router>
  );
};

export default AppRoutes;
