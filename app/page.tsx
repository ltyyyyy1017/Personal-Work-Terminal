import Workbench from "@/components/workbench";
import AccountGate from "@/components/account-access";
export const dynamic = "force-dynamic";
export default function Page() { return <AccountGate><Workbench /></AccountGate>; }
