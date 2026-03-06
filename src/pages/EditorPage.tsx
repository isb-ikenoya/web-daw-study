import DawEditor from "@/components/DawEditor";
import Sidebar from "@/components/AppSidebar";
import SplitArea from "@/components/SplitArea";

const EditorPage = () => {
  return <SplitArea left={<Sidebar />} right={<DawEditor />} />;
};

export default EditorPage;
