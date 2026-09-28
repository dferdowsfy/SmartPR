import { redirect } from "next/navigation";

/** /rehearsal-portal/suri → the SURI clone's login. */
export default function SuriRehearsalIndex() {
  redirect("/rehearsal-portal/suri/login");
}
