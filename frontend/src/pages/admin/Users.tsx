import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Role, User } from "../../api/generated";
import { useFeedback } from "../../components/feedback";
import { Button, ErrorNotice, Input, Modal, Select } from "../../components/ui";

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api<User[]>("/admin/users"),
  });
  const [creating, setCreating] = useState(false);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const { confirm, toast } = useFeedback();
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api<User>(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
  async function remove(user: User) {
    const ok = await confirm({
      title: `Delete ${user.username}?`,
      message: "This also permanently deletes the user's chats.",
      confirmText: "Delete user",
      danger: true,
    });
    if (!ok) return;
    await api<void>(`/admin/users/${user.id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    toast(`Deleted ${user.username}.`, "success");
  }
  return (
    <AdminPage
      title="Users"
      description="Accounts are created and managed by administrators."
    >
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus size={17} /> Create user
        </Button>
      </div>
      <div className="panel overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b border-[var(--border)] text-[var(--muted)]">
            <tr>
              <th className="p-4">User</th>
              <th>Role</th>
              <th>Status</th>
              <th className="pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((user) => (
              <tr
                key={user.id}
                className="border-b border-[var(--border)] last:border-0"
              >
                <td className="p-4">
                  <strong>{user.username}</strong>
                  <span className="block text-xs text-[var(--muted)]">
                    {user.email ?? "No email"}
                  </span>
                </td>
                <td>
                  <Select
                    label={`Role for ${user.username}`}
                    value={user.role}
                    onValueChange={(role) =>
                      update.mutate({ id: user.id, body: { role } })
                    }
                    options={[
                      { value: "user", label: "User" },
                      { value: "admin", label: "Admin" },
                    ]}
                  />
                </td>
                <td>
                  <button
                    className={`rounded-full px-3 py-1 font-semibold ${user.disabled ? "bg-red-500/10 text-[var(--danger)]" : "bg-green-500/10 text-green-700 dark:text-green-400"}`}
                    onClick={() =>
                      update.mutate({
                        id: user.id,
                        body: { disabled: !user.disabled },
                      })
                    }
                  >
                    {user.disabled
                      ? "Disabled"
                      : user.must_change_password
                        ? "Password change required"
                        : "Active"}
                  </button>
                </td>
                <td className="pr-4">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      aria-label={`Reset password for ${user.username}`}
                      onClick={() => setResetUser(user)}
                    >
                      <KeyRound size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Delete ${user.username}`}
                      onClick={() => void remove(user)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateUser
        open={creating}
        onOpenChange={setCreating}
        onCreated={() =>
          queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
        }
      />
      <ResetPassword
        user={resetUser}
        onOpenChange={(open) => !open && setResetUser(null)}
        onReset={() =>
          queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
        }
      />
      <ErrorNotice error={users.error ?? update.error} />
    </AdminPage>
  );
}

function CreateUser({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "user" as Role,
  });
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<User>("/admin/users", {
        method: "POST",
        body: JSON.stringify({ ...form, email: form.email || null }),
      });
      onCreated();
      onOpenChange(false);
      setForm({ username: "", email: "", password: "", role: "user" });
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create user">
      <form className="grid gap-4" onSubmit={submit}>
        <Input
          label="Username"
          required
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Input
          label="Temporary password"
          type="password"
          minLength={12}
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          hint="The user must change this after signing in."
        />
        <Select
          label="Role"
          value={form.role}
          onValueChange={(role) => setForm({ ...form, role: role as Role })}
          options={[
            { value: "user", label: "User" },
            { value: "admin", label: "Admin" },
          ]}
        />
        <ErrorNotice error={error} />
        <Button type="submit">Create user</Button>
      </form>
    </Modal>
  );
}

function ResetPassword({
  user,
  onOpenChange,
  onReset,
}: {
  user: User | null;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<User>(`/admin/users/${user!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ replacement_password: password }),
      });
      setPassword("");
      onReset();
      onOpenChange(false);
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <Modal
      open={Boolean(user)}
      onOpenChange={onOpenChange}
      title={`Reset ${user?.username ?? "user"} password`}
    >
      <form className="grid gap-4" onSubmit={submit}>
        <p className="text-sm text-[var(--muted)]">
          All existing sessions will be revoked and the user must change this
          password at next login.
        </p>
        <Input
          label="Replacement password"
          type="password"
          minLength={12}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorNotice error={error} />
        <Button type="submit">Reset password</Button>
      </form>
    </Modal>
  );
}

export function AdminPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl p-5 py-10">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">{description}</p>
      <div className="mt-7">{children}</div>
    </div>
  );
}
