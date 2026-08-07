package com.demo.core.models.totc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class StatsStripModel {

    @ChildResource
    private List<Stat> stats;

    @PostConstruct
    protected void init() {
        if (stats == null) {
            stats = Collections.emptyList();
        } else {
            List<Stat> filtered = new ArrayList<>();
            for (Stat s : stats) {
                if (s != null && s.hasContent()) {
                    filtered.add(s);
                }
            }
            stats = Collections.unmodifiableList(filtered);
        }
    }

    public List<Stat> getStats() { return stats; }

    public boolean isHasContent() { return !stats.isEmpty(); }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Stat {
        @ValueMapValue private String value;
        @ValueMapValue private String label;

        public String getValue() { return value; }
        public String getLabel() { return label; }

        public boolean hasContent() {
            return StringUtils.isNotBlank(value) && StringUtils.isNotBlank(label);
        }
    }
}
