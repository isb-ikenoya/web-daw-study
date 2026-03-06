import { Box, styled } from "@mui/material";

const SidebarContainer = styled(Box)({
  padding: "0",
  margin: "0",
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexFlow: "row",
  backgroundColor: "green",
});

const AppSidebar = () => {
  return <SidebarContainer />;
};

export default AppSidebar;
