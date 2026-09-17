import { redirect } from 'next/navigation';

export default function InternalRootPage() {
  redirect('/internal/command-center');
}
