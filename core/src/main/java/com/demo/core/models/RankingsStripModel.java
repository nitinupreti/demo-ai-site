/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import javax.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class RankingsStripModel {

    @ValueMapValue private String heading;
    @ChildResource private List<RankingItem> rankings;

    @PostConstruct
    protected void init() {
        if (rankings == null) {
            rankings = Collections.emptyList();
            return;
        }
        List<RankingItem> out = new ArrayList<>();
        for (RankingItem r : rankings) {
            if (r != null && StringUtils.isNotBlank(r.getRank())) out.add(r);
        }
        rankings = out;
    }

    public String getHeading() { return heading; }
    public List<RankingItem> getRankings() { return rankings; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading) || (rankings != null && !rankings.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class RankingItem {
        @ValueMapValue private String rank;
        @ValueMapValue private String description;
        @ValueMapValue private String source;
        public String getRank() { return rank; }
        public String getDescription() { return description; }
        public String getSource() { return source; }
    }
}
