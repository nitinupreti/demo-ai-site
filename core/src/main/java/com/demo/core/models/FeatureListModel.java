package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FeatureListModel {

    @ChildResource
    private List<FeatureItemModel> items;

    private List<FeatureItemModel> filtered;

    @PostConstruct
    void init() {
        filtered = new ArrayList<>();
        if (items != null) {
            int idx = 0;
            for (FeatureItemModel it : items) {
                if (it != null && it.isHasContent()) {
                    it.applyAutoSide(idx);
                    filtered.add(it);
                    idx++;
                }
            }
        }
    }

    public List<FeatureItemModel> getItems() {
        return Collections.unmodifiableList(filtered);
    }

    public boolean isHasContent() {
        return !filtered.isEmpty();
    }
}
