# useshipcheck-action

GitHub Action for a [ShipCheck](https://useshipcheck.com) checkup. It calls `POST /api/v1/scan` on `https://useshipcheck.com`, the same public API as `npx useshipcheck`.

A run without `api-token` is a free passive preview. It does not spend a credit. With a token from the ShipCheck billing page, the run is a full checkup and spends one credit.

On a pull request the action posts one comment and updates that same comment on later runs. The comment has the grade, the category grades, and a link to the public score card. It does not include secrets or finding evidence.

The action fails only when `fail-on-grade` is set and the letter is that grade or worse. A is best and F is worst, so `D` fails on D and F.

This folder is the whole repository. Publish it on its own as `useshipcheck/useshipcheck-action`. The Marketplace search for `useshipcheck-action` had no listing when this was written. `shipcheck-action` is a different project.

## Workflow

```yaml
name: ShipCheck
on:
  pull_request:
jobs:
  checkup:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: useshipcheck/useshipcheck-action@v1
        id: shipcheck
        with:
          url: https://your-preview.example
          # api-token: ${{ secrets.SHIPCHECK_TOKEN }}
          # fail-on-grade: D
      - run: echo "${{ steps.shipcheck.outputs.grade }} ${{ steps.shipcheck.outputs.share-url }}"
```

Use the preview or production URL of the app the pull request deploys. `comment` defaults to `true`. Set it to `false` to skip the pull request comment.

Outputs are `grade` and `share-url`.

## Tests

```bash
node --test
```

Node 20 or newer. No install step. One test calls `https://useshipcheck.com/sample-app` and mocks the GitHub comment API.
