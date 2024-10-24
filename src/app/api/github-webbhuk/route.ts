import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// Supabase configuration
const SUPABASE_URL = "https://rsjghyvydgadiohbaofg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzamdoeXZ5ZGdhZGlvaGJhb2ZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyOTQyNDE0OSwiZXhwIjoyMDQ1MDAwMTQ5fQ.m6ahlj5ItQli2o-6X-nArttJx2ENYxUi_Ta9AMuoWLc";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const GITHUB_API_URL = 'https://api.github.com/repos/AlgoFoe/tree-visualizer';
const VERCEL_DEPLOYMENTS_API = "https://api.vercel.com/v6/deployments";
const VERCEL_API_TOKEN = "k9RwIrkjZ8zRTGblGuK0O8gP"; 

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const event = req.headers.get('x-github-event'); 

    console.log("Received event:", event);
    console.log("Payload:", payload);

    switch (event) {
      case 'watch':
      case 'fork': {
        const { data } = await axios.get(GITHUB_API_URL);
        const starsCount = data.stargazers_count;
        const forksCount = data.forks_count;

        await supabase.from('stats').upsert(
          [
            { type: 'stars', count: starsCount },
            { type: 'forks', count: forksCount }
          ],
          { onConflict: 'type' }
        );
        break;
      }

      case 'push': {
        const commitMessage = payload.head_commit?.message;
        const commitAuthor = payload.pusher?.name;
        const commitTimestamp = payload.head_commit?.timestamp;
        const commitSha = payload.head_commit?.id || payload.head_commit?.sha;

        console.log({
          message: commitMessage,
          author: commitAuthor,
          timestamp: commitTimestamp,
          sha: commitSha,
          color: 'text-yellow-600'
        });

        if (commitMessage && commitAuthor && commitTimestamp && commitSha) {
          await supabase.from('commits').insert([
            {
              message: commitMessage,
              author: commitAuthor,
              timestamp: commitTimestamp,
              sha: commitSha,
              color: 'text-yellow-600'
            },
          ]);
        }
        break;
      }

      case 'pull_request': {
        if (payload.action === 'closed' && payload.pull_request?.merged) {
          const prTitle = payload.pull_request?.title;
          const prAuthor = payload.pull_request?.user?.login;
          const prMergedAt = payload.pull_request?.merged_at;
          const prSha = payload.pull_request?.merge_commit_sha;

          if (prTitle && prAuthor && prMergedAt && prSha) {
            await supabase.from('commits').insert([
              {
                message: `PR merged: ${prTitle}`,
                author: prAuthor,
                timestamp: prMergedAt,
                sha: prSha,
                color: 'text-yellow-600'
              },
            ]);
          }
        }
        break;
      }

      case 'status': {
        // fetch the latest deployment details from Vercel with authorization
        const deploymentsRes = await axios.get(VERCEL_DEPLOYMENTS_API, {
          headers: {
            Authorization: `Bearer ${VERCEL_API_TOKEN}`,
          },
        });

        const latestDeployment = deploymentsRes.data.deployments[0];
        const deploymentId = latestDeployment.uid;
        const deploymentSha = latestDeployment.meta.githubCommitSha;
        const deploymentState = latestDeployment.state;

        const color =
          deploymentState === 'QUEUED' || 'BUILDING' ? 'text-yellow-700' :
          deploymentState === 'READY' ? 'text-green-500' :
          'text-red-300';

        console.log({
          deployment_id: deploymentId,
          state: deploymentState,
          created_at: new Date(latestDeployment.created).toISOString(),
          sha: deploymentSha,
        });

        if (deploymentSha) {
          await supabase.from('deployments').upsert(
            [
              {
                deployment_id: deploymentId,
                state: deploymentState,
                created_at: new Date(latestDeployment.created).toISOString(),
                sha: deploymentSha,
              },
            ],
            { onConflict: 'deployment_id' }
          );
          await supabase
            .from('commits')
            .update({ color: color })
            .eq('sha', deploymentSha);
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${event}`);
    }

    return NextResponse.json({ message: 'Webhook data processed and stored' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { message: 'Error processing webhook' },
      { status: 500 }
    );
  }
}
